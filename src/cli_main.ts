#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import path from "path";
import {
  addAccount,
  ensureAccountConfig,
  ensureAccountDir,
  ensureBaseDir,
  getAccountOrder,
  removeAccount,
  setDefaultAccount,
  validateAccountName
} from "./account_manager";
import { isCodexLoggedIn, runCodexLogin } from "./codex_auth";
import { AUTH_FILE_NAME } from "./constants";
import { getAccountDir, getBaseDir } from "./paths";
import { loadRegistry } from "./registry_store";
import { runCodexOnce } from "./process_runner";

interface AddOptions {
  codex: string;
  login: boolean;
  deviceAuth: boolean;
}

interface RunOptions {
  account?: string;
  codex: string;
  fallback: boolean;
  maxPasses: string;
  retryDelay: string;
}

const program = new Command();

program
  .name("codex-account-orchestrator")
  .description("Codex OAuth account fallback orchestrator")
  .option("--data-dir <path>", "Custom data directory");

program
  .command("add")
  .argument("<name>", "Account name")
  .description("Register a new account and create its config")
  .option("--codex <path>", "Path to the codex binary", "codex")
  .option("--no-login", "Skip OAuth login")
  .option("--device-auth", "Use device auth flow")
  .action(async (name: string, options: AddOptions) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    const registry = addAccount(baseDir, name);
    const normalizedName = validateAccountName(name);
    const accountDir = getAccountDir(baseDir, normalizedName);

    process.stdout.write(`Added account: ${normalizedName}\n`);
    process.stdout.write(`Account directory: ${accountDir}\n`);
    process.stdout.write(`Default account: ${registry.default_account ?? "(none)"}\n`);
    process.stdout.write("Run `cao run` to start with fallback.\n");

    if (!options.login) {
      return;
    }

    const alreadyLoggedIn = await isCodexLoggedIn(options.codex, accountDir);

    if (alreadyLoggedIn) {
      process.stdout.write("OAuth already configured for this account.\n");
      return;
    }

    process.stdout.write("Starting OAuth login...\n");
    const exitCode = await runCodexLogin(options.codex, accountDir, options.deviceAuth);

    if (exitCode !== 0) {
      process.stderr.write("OAuth login failed.\n");
      process.exit(exitCode);
    }

    const authPath = getAuthFilePath(accountDir);
    if (!fs.existsSync(authPath)) {
      process.stderr.write(
        "Warning: OAuth login completed but auth.json was not found. Check your Codex auth store.\n"
      );
    }
  });

program
  .command("list")
  .description("List registered accounts")
  .action(() => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const registry = loadRegistry(baseDir);

    if (registry.accounts.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    for (const name of registry.accounts) {
      const marker = registry.default_account === name ? "*" : " ";
      const accountDir = getAccountDir(baseDir, name);
      const loggedIn = fs.existsSync(getAuthFilePath(accountDir));
      const status = loggedIn ? "logged-in" : "not-logged-in";
      process.stdout.write(`${marker} ${name} (${status})\n`);
    }
  });

program
  .command("use")
  .argument("<name>", "Account name")
  .description("Set the default account")
  .action((name: string) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    const registry = setDefaultAccount(baseDir, name);
    process.stdout.write(`Default account set to: ${registry.default_account}\n`);
  });

program
  .command("remove")
  .argument("<name>", "Account name")
  .option("--keep-files", "Keep account files on disk")
  .description("Remove an account from fallback rotation")
  .action((name: string, options: { keepFiles: boolean }) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    const registry = removeAccount(baseDir, name, !options.keepFiles);
    process.stdout.write(`Removed account: ${name}\n`);
    process.stdout.write(`Default account: ${registry.default_account ?? "(none)"}\n`);
  });

program
  .command("run")
  .option("--account <name>", "Run with a specific account")
  .option("--codex <path>", "Path to the codex binary", "codex")
  .option("--no-fallback", "Disable automatic fallback")
  .option("--max-passes <count>", "Retry passes when all accounts hit quota", "2")
  .option("--retry-delay <seconds>", "Delay between retry passes in seconds", "0")
  .description("Run codex with OAuth fallback across accounts")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (options: RunOptions) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);

    const registry = loadRegistry(baseDir);
    const orderedAccounts = getAccountOrder(registry);
    const codexArgs = normalizeCodexArgs(getCodexArgs(process.argv), options.codex);

    if (orderedAccounts.length === 0) {
      process.stderr.write("No accounts registered. Use `cao add <name>` first.\n");
      process.exit(1);
      return;
    }

    const resolvedAccounts = resolveAccounts(orderedAccounts, options.account);

    if (resolvedAccounts.length === 0) {
      process.stderr.write("No matching accounts found.\n");
      process.exit(1);
      return;
    }

    await runWithFallback(options, baseDir, resolvedAccounts, codexArgs);
  });

program.parse(process.argv);

function resolveAccounts(ordered: string[], requested?: string): string[] {
  if (!requested) {
    return ordered;
  }

  const normalized = validateAccountName(requested);

  if (ordered.includes(normalized)) {
    return [normalized];
  }

  return [];
}

function getCodexArgs(argv: string[]): string[] {
  const separatorIndex = argv.indexOf("--");

  if (separatorIndex === -1) {
    return [];
  }

  return argv.slice(separatorIndex + 1);
}

function normalizeCodexArgs(args: string[], codexBin: string): string[] {
  if (args.length === 0) {
    return args;
  }

  if (codexBin === "codex" && args[0] === "codex") {
    return args.slice(1);
  }

  return args;
}

function getAuthFilePath(accountDir: string): string {
  return path.join(accountDir, AUTH_FILE_NAME);
}

async function runWithFallback(
  options: RunOptions,
  baseDir: string,
  accounts: string[],
  codexArgs: string[]
): Promise<void> {
  const codexBin = options.codex;
  const maxPasses = normalizeMaxPasses(options.maxPasses);
  const retryDelayMs = normalizeDelay(options.retryDelay);

  for (let passIndex = 0; passIndex < maxPasses; passIndex += 1) {
    let quotaFailures = 0;
    let lastExitCode = 1;

    for (let index = 0; index < accounts.length; index += 1) {
      const name = accounts[index];
      const accountDir = ensureAccountDir(baseDir, name);
      ensureAccountConfig(accountDir);

      process.stderr.write(`Using account: ${name}\n`);

      const result = await runCodexOnce(codexBin, codexArgs, accountDir, options.fallback);
      lastExitCode = result.exitCode;

      if (result.exitCode === 0) {
        process.exit(0);
        return;
      }

      if (!options.fallback) {
        process.exit(result.exitCode);
        return;
      }

      if (!result.quotaError) {
        process.exit(result.exitCode);
        return;
      }

      quotaFailures += 1;
      const nextName = accounts[index + 1];

      if (nextName) {
        process.stderr.write(`Quota exhausted. Falling back to: ${nextName}\n`);
      }
    }

    if (!options.fallback) {
      process.exit(lastExitCode);
      return;
    }

    if (quotaFailures === accounts.length) {
      if (passIndex < maxPasses - 1) {
        process.stderr.write("All accounts hit quota. Rechecking...\n");

        if (retryDelayMs > 0) {
          await delay(retryDelayMs);
        }

        continue;
      }

      process.stderr.write("All accounts exhausted due to quota.\n");
      process.exit(lastExitCode);
      return;
    }
  }
}

function normalizeMaxPasses(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function normalizeDelay(value: string): number {
  const parsed = Number.parseFloat(value);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed * 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
