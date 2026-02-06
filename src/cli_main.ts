#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";
import { createInterface } from "readline/promises";
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
import {
  DEFAULT_HEALTH_OPTIONS,
  summarizeHealth,
  type HealthCheckOptions
} from "./account_health";
import { inspectAccounts, type AccountInspection } from "./account_inspector";
import { updateAccountStatus } from "./account_status_store";
import { isCodexLoggedIn, runCodexLogin } from "./codex_auth";
import { AUTH_FILE_NAME } from "./constants";
import { disableGatewayConfig, enableGatewayConfig, getCodexConfigPath } from "./gateway/codex_config";
import { AccountPool } from "./gateway/account_pool";
import { loadGatewayConfig, resolveGatewayConfig, saveGatewayConfig } from "./gateway/gateway_config";
import { startGatewayServer } from "./gateway/server";
import { disableGatewayShim, enableGatewayShim } from "./gateway/codex_shim";
import type { GatewayConfig } from "./gateway/gateway_config";
import { getAccountDir, getBaseDir } from "./paths";
import { loadRegistry } from "./registry_store";
import { runCodexOnce } from "./process_runner";

interface AddOptions {
  codex: string;
  login: boolean;
  deviceAuth: boolean;
}

interface StatusOptions {
  json: boolean;
  compact: boolean;
  pretty: boolean;
  doctor: boolean;
  report?: string | boolean;
  full: boolean;
  expiresWithinHours: string;
  maxFailures: string;
}

interface ImportCodexAuthOptions {
  source: string;
  overwrite: boolean;
  current?: string;
  default?: string;
}

interface DoctorOptions {
  expiresWithinHours: string;
  maxFailures: string;
}

interface RunOptions {
  account?: string;
  codex: string;
  fallback: boolean;
  gateway: boolean;
  gatewayUrl: string;
  maxPasses: string;
  retryDelay: string;
}

interface GatewayStartOptions {
  bind: string;
  port: string;
  baseUrl: string;
  cooldownSeconds: string;
  maxRetryPasses: string;
  timeoutMs: string;
  upstreamRetries: string;
  upstreamRetryBaseMs: string;
  upstreamRetryMaxMs: string;
  upstreamRetryJitterMs: string;
  save: boolean;
  passthroughAuth?: boolean;
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
    const inspections = inspectAccounts(baseDir);

    if (inspections.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    renderAccountSummary(inspections);
  });

program
  .command("switch")
  .argument("[name]", "Account name")
  .description("Switch the default account (interactive if omitted)")
  .action(async (name?: string) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);

    const inspections = inspectAccounts(baseDir);
    if (inspections.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    const resolved = name ?? (await promptForAccountSelection(inspections));

    if (!resolved) {
      process.stdout.write("No account selected.\n");
      return;
    }

    const registry = setDefaultAccount(baseDir, resolved);
    process.stdout.write(`Default account set to: ${registry.default_account}\n`);
  });

program
  .command("current")
  .description("Show the current default account")
  .action(() => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const registry = loadRegistry(baseDir);

    if (!registry.default_account) {
      process.stdout.write("No default account set.\n");
      return;
    }

    process.stdout.write(`${registry.default_account}\n`);
  });

program
  .command("status")
  .description("Show account status, health checks, and reports")
  .option("--json", "Output account status as JSON")
  .option("--compact", "Output a compact one-line summary per account")
  .option("--pretty", "Render a framed dashboard view")
  .option("--full", "Output the verbose multi-line status view")
  .option("--doctor", "Run health checks (exit codes)")
  .option("--report [format]", "Generate a report (md or json)")
  .option(
    "--expires-within-hours <hours>",
    "Warn when tokens expire within this window (doctor only)",
    `${DEFAULT_HEALTH_OPTIONS.expiresWithinHours}`
  )
  .option(
    "--max-failures <count>",
    "Warn when consecutive failures exceed this count (doctor only)",
    `${DEFAULT_HEALTH_OPTIONS.maxFailures}`
  )
  .action((options: StatusOptions) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const inspections = inspectAccounts(baseDir);

    if (inspections.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    if (options.report !== undefined) {
      const format = normalizeReportFormat(options.report);

      if (format === "json") {
        renderAccountReportJson(inspections);
        return;
      }

      renderAccountReportMarkdown(inspections);
      return;
    }

    if (options.doctor) {
      const healthOptions = normalizeHealthOptions(options);
      const summary = summarizeHealth(inspections, healthOptions);

      if (options.json) {
        renderDoctorJson(inspections, summary, healthOptions);
        process.exitCode = summary.errorCount > 0 ? 2 : summary.warnCount > 0 ? 1 : 0;
        return;
      }

      renderDoctorReport(inspections, summary, healthOptions);
      process.exitCode = summary.errorCount > 0 ? 2 : summary.warnCount > 0 ? 1 : 0;
      return;
    }

    if (options.json) {
      renderAccountDetailsJson(inspections);
      return;
    }

    if (options.compact) {
      renderAccountCompact(inspections);
      return;
    }

    if (options.full) {
      renderAccountDetails(inspections);
      return;
    }

    if (options.pretty || process.stdout.isTTY) {
      renderAccountPretty(inspections, baseDir);
      return;
    }

    renderAccountCompact(inspections);
  });

program
  .command("doctor")
  .description("Deprecated. Use `cao status --doctor` instead.")
  .option("--json", "Output health check results as JSON")
  .option(
    "--expires-within-hours <hours>",
    "Warn when tokens expire within this window",
    `${DEFAULT_HEALTH_OPTIONS.expiresWithinHours}`
  )
  .option(
    "--max-failures <count>",
    "Warn when consecutive failures exceed this count",
    `${DEFAULT_HEALTH_OPTIONS.maxFailures}`
  )
  .action((options: DoctorOptions & { json: boolean }) => {
    process.stderr.write("Warning: `cao doctor` is deprecated. Use `cao status --doctor`.\n");
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const inspections = inspectAccounts(baseDir);

    if (inspections.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    const healthOptions = normalizeHealthOptions(options);
    const summary = summarizeHealth(inspections, healthOptions);

    if (options.json) {
      renderDoctorJson(inspections, summary, healthOptions);
      process.exitCode = summary.errorCount > 0 ? 2 : summary.warnCount > 0 ? 1 : 0;
      return;
    }

    renderDoctorReport(inspections, summary, healthOptions);
    process.exitCode = summary.errorCount > 0 ? 2 : summary.warnCount > 0 ? 1 : 0;
  });

program
  .command("report")
  .description("Deprecated. Use `cao status --report` instead.")
  .option("--format <format>", "Output format: md or json", "md")
  .action((options: { format: string }) => {
    process.stderr.write("Warning: `cao report` is deprecated. Use `cao status --report`.\n");
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const inspections = inspectAccounts(baseDir);

    if (inspections.length === 0) {
      process.stdout.write("No accounts registered. Use `cao add <name>` first.\n");
      return;
    }

    const format = options.format.toLowerCase();

    if (format === "json") {
      renderAccountReportJson(inspections);
      return;
    }

    renderAccountReportMarkdown(inspections);
  });

const importCommand = program.command("import").description("Import accounts from other tools");

importCommand
  .command("codex-auth")
  .description("Import account snapshots from codex-auth")
  .option(
    "--source <path>",
    "Source directory with codex-auth snapshots",
    path.join(os.homedir(), ".codex", "accounts")
  )
  .option("--overwrite", "Overwrite existing auth.json files")
  .option("--current <name>", "Treat this account as active during import")
  .option("--default <name>", "Set this account as the default after import")
  .action((options: ImportCodexAuthOptions) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);

    const sourceDir = path.resolve(options.source);

    if (!fs.existsSync(sourceDir)) {
      process.stderr.write(`Source directory not found: ${sourceDir}\n`);
      process.exit(1);
      return;
    }

    const entries = fs.readdirSync(sourceDir);
    const snapshotFiles = entries.filter((entry) => entry.endsWith(".json"));

    if (snapshotFiles.length === 0) {
      process.stdout.write(`No snapshot files found in ${sourceDir}.\n`);
      return;
    }

    const importedNames: string[] = [];
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const fileName of snapshotFiles) {
      const rawName = path.basename(fileName, ".json");
      let normalizedName: string;

      try {
        normalizedName = validateAccountName(rawName);
      } catch (error) {
        process.stderr.write(
          `Skipping snapshot '${fileName}': ${(error as Error).message}\n`
        );
        errorCount += 1;
        continue;
      }

      const sourcePath = path.join(sourceDir, fileName);
      let parsed: unknown;

      try {
        parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as unknown;
      } catch (error) {
        process.stderr.write(
          `Skipping snapshot '${fileName}': invalid JSON (${(error as Error).message}).\n`
        );
        errorCount += 1;
        continue;
      }

      addAccount(baseDir, normalizedName);
      const accountDir = getAccountDir(baseDir, normalizedName);
      ensureAccountConfig(accountDir);
      const authPath = getAuthFilePath(accountDir);

      if (fs.existsSync(authPath) && !options.overwrite) {
        skippedCount += 1;
        continue;
      }

      fs.writeFileSync(authPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
      importedNames.push(normalizedName);
      importedCount += 1;

    }

    const activeName =
      options.default ??
      options.current ??
      findCodexAuthActiveAccount(sourceDir) ??
      undefined;

    if (activeName) {
      try {
        const normalizedActive = validateAccountName(activeName);
        const registry = loadRegistry(baseDir);

        if (registry.accounts.includes(normalizedActive)) {
          setDefaultAccount(baseDir, normalizedActive);
          process.stdout.write(`Default account set to: ${normalizedActive}\n`);
        } else {
          process.stderr.write(
            `Requested default '${normalizedActive}' not found in imported accounts.\n`
          );
        }
      } catch (error) {
        process.stderr.write(
          `Unable to set default account '${activeName}': ${(error as Error).message}\n`
        );
      }
    }

    process.stdout.write(
      `Import complete. Imported: ${importedCount}, skipped: ${skippedCount}, errors: ${errorCount}.\n`
    );

    if (importedNames.length > 0) {
      process.stdout.write(`Imported accounts: ${importedNames.join(", ")}\n`);
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

const gateway = program.command("gateway").description("Manage CAO gateway");

gateway
  .command("start")
  .description("Start the local gateway for seamless account switching")
  .option("--bind <address>", "Bind address", "127.0.0.1")
  .option("--port <port>", "Port", "4319")
  .option("--base-url <url>", "Upstream OpenAI base URL", "https://chatgpt.com/backend-api/codex")
  .option("--cooldown-seconds <seconds>", "Cooldown for quota-hit accounts", "900")
  .option("--max-retry-passes <count>", "Max retry passes per request", "1")
  .option("--timeout-ms <ms>", "Request timeout in milliseconds", "120000")
  .option("--upstream-retries <count>", "Retries for upstream 5xx/network errors", "2")
  .option("--upstream-retry-base-ms <ms>", "Base delay for upstream retries", "200")
  .option("--upstream-retry-max-ms <ms>", "Max delay for upstream retries", "2000")
  .option("--upstream-retry-jitter-ms <ms>", "Jitter for upstream retries", "120")
  .option("--passthrough-auth", "Do not override Authorization header")
  .option("--save", "Persist options to gateway.json")
  .action((options: GatewayStartOptions) => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);

    const overrides = buildGatewayOverrides(options);
    const merged = resolveGatewayConfig({
      ...loadGatewayConfig(),
      ...overrides
    });

    if (options.save) {
      saveGatewayConfig({
        bindAddress: merged.bindAddress,
        port: merged.port,
        baseUrl: merged.baseUrl,
        cooldownSeconds: merged.cooldownSeconds,
        maxRetryPasses: merged.maxRetryPasses,
        requestTimeoutMs: merged.requestTimeoutMs,
        upstreamMaxRetries: merged.upstreamMaxRetries,
        upstreamRetryBaseMs: merged.upstreamRetryBaseMs,
        upstreamRetryMaxMs: merged.upstreamRetryMaxMs,
        upstreamRetryJitterMs: merged.upstreamRetryJitterMs,
        overrideAuth: merged.overrideAuth
      });
    }

    const pool = AccountPool.loadFromRegistry(baseDir);

    if (pool.getAccounts().length === 0) {
      process.stderr.write("No accounts with auth.json were found. Run `cao add` first.\n");
      process.exit(1);
      return;
    }

    const server = startGatewayServer(pool, merged);

    process.stdout.write(
      `Gateway started on http://${merged.bindAddress}:${merged.port} (upstream ${merged.baseUrl})\n`
    );

    process.on("SIGINT", () => {
      server.close(() => {
        process.stdout.write("Gateway stopped.\n");
        process.exit(0);
      });
    });
  });

gateway
  .command("status")
  .description("Show gateway config and account readiness")
  .action(() => {
    const baseDir = getBaseDir(program.opts().dataDir);
    ensureBaseDir(baseDir);
    const config = resolveGatewayConfig(loadGatewayConfig());
    const pool = AccountPool.loadFromRegistry(baseDir);
    const inspections = inspectAccounts(baseDir);
    const inspectionsByName = new Map(inspections.map((inspection) => [inspection.name, inspection]));
    const nowMs = Date.now();

    process.stdout.write(`Bind: ${config.bindAddress}:${config.port}\n`);
    process.stdout.write(`Upstream: ${config.baseUrl}\n`);
    process.stdout.write(`Override auth: ${config.overrideAuth ? "yes" : "no"}\n`);
    process.stdout.write(`Accounts: ${pool.getAccounts().length}\n`);

    for (const account of pool.getAccounts()) {
      const inspection = inspectionsByName.get(account.name);
      const cooldown =
        account.cooldownUntilMs > nowMs
          ? `cooldown ${Math.ceil((account.cooldownUntilMs - nowMs) / 1000)}s`
          : "ready";
      const tokenExpiry = formatTimestampWithRelative(inspection?.tokenDetails?.expiresAtMs, nowMs);
      const lastRefresh = formatTimestampWithRelative(inspection?.lastRefreshAtMs, nowMs);
      process.stdout.write(
        `- ${account.name} (${cooldown}) | token_expires_at: ${tokenExpiry} | last_refresh_at: ${lastRefresh}\n`
      );
    }
  });

gateway
  .command("enable")
  .description("Install a codex shim that routes traffic through the gateway")
  .option("--base-url <url>", "Gateway base URL", "http://127.0.0.1:4319")
  .action((options: { baseUrl: string }) => {
    disableGatewayConfig();
    enableGatewayConfig({ baseUrl: options.baseUrl });
    const result = enableGatewayShim(options.baseUrl);
    process.stdout.write(`Codex config updated: ${getCodexConfigPath()}\n`);
    process.stdout.write(`Codex shim installed: ${result.shimPath}\n`);
    process.stdout.write(`Real codex: ${result.realCodexPath}\n`);
    if (!result.inPath) {
      process.stdout.write(
        `Warning: ${path.dirname(result.shimPath)} is not in PATH. Update PATH to use the shim.\n`
      );
    }
  });

gateway
  .command("disable")
  .description("Remove the codex shim and restore config backup if present")
  .action(() => {
    const removed = disableGatewayShim();
    disableGatewayConfig();
    process.stdout.write(`Codex config restored: ${getCodexConfigPath()}\n`);
    process.stdout.write(removed ? "Codex shim removed.\n" : "No codex shim found.\n");
  });

program
  .command("run")
  .option("--account <name>", "Run with a specific account")
  .option("--codex <path>", "Path to the codex binary", "codex")
  .option("--gateway", "Route Codex traffic through the local gateway")
  .option("--gateway-url <url>", "Gateway base URL", "http://127.0.0.1:4319")
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

function normalizeHealthOptions(options: DoctorOptions): HealthCheckOptions {
  const expiresWithinHours = Number.parseInt(options.expiresWithinHours, 10);
  const maxFailures = Number.parseInt(options.maxFailures, 10);

  return {
    expiresWithinHours: Number.isNaN(expiresWithinHours)
      ? DEFAULT_HEALTH_OPTIONS.expiresWithinHours
      : Math.max(1, expiresWithinHours),
    maxFailures: Number.isNaN(maxFailures)
      ? DEFAULT_HEALTH_OPTIONS.maxFailures
      : Math.max(1, maxFailures)
  };
}

function normalizeReportFormat(value: string | boolean | undefined): "md" | "json" {
  if (typeof value === "string" && value.toLowerCase() === "json") {
    return "json";
  }

  return "md";
}

async function promptForAccountSelection(
  inspections: AccountInspection[]
): Promise<string | undefined> {
  if (!process.stdin.isTTY) {
    process.stderr.write("No TTY available. Please provide an account name.\n");
    return undefined;
  }

  process.stdout.write("Select an account:\n");
  for (let index = 0; index < inspections.length; index += 1) {
    const inspection = inspections[index];
    const marker = inspection.isDefault ? "*" : " ";
    process.stdout.write(`${index + 1}. ${marker} ${inspection.name}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Enter a number or name (blank to cancel): ")).trim();
  rl.close();

  if (!answer) {
    return undefined;
  }

  const index = Number.parseInt(answer, 10);
  if (!Number.isNaN(index)) {
    const selected = inspections[index - 1];
    return selected?.name;
  }

  try {
    const normalized = validateAccountName(answer);
    const exists = inspections.some((inspection) => inspection.name === normalized);

    if (!exists) {
      process.stderr.write(`Account not found: ${normalized}\n`);
      return undefined;
    }

    return normalized;
  } catch (error) {
    process.stderr.write(`Invalid account name: ${(error as Error).message}\n`);
    return undefined;
  }
}

function findCodexAuthActiveAccount(sourceDir: string): string | undefined {
  const parentDir = path.dirname(sourceDir);
  const candidates = [
    path.join(sourceDir, ".active"),
    path.join(sourceDir, "active"),
    path.join(sourceDir, ".current"),
    path.join(sourceDir, "current"),
    path.join(sourceDir, ".selected"),
    path.join(sourceDir, "selected"),
    path.join(parentDir, ".active"),
    path.join(parentDir, "active"),
    path.join(parentDir, ".current"),
    path.join(parentDir, "current"),
    path.join(parentDir, ".selected"),
    path.join(parentDir, "selected")
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const value = fs.readFileSync(candidate, "utf8").trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function renderAccountSummary(inspections: AccountInspection[]): void {
  for (const inspection of inspections) {
    const marker = inspection.isDefault ? "*" : " ";
    const status = inspection.loggedIn ? "logged-in" : "not-logged-in";
    process.stdout.write(`${marker} ${inspection.name} (${status})\n`);
  }
}

function toAccountDetailRecord(
  inspection: AccountInspection,
  referenceMs: number
): Record<string, unknown> {
  const status = inspection.status ?? {};
  const tokenExpiresAtMs = inspection.tokenDetails?.expiresAtMs;
  const cooldownUntilMs = status.cooldownUntilMs;
  const cooldownRemainingMs =
    cooldownUntilMs && cooldownUntilMs > referenceMs ? cooldownUntilMs - referenceMs : 0;

  return {
    name: inspection.name,
    isDefault: inspection.isDefault,
    loggedIn: inspection.loggedIn,
    accountId: inspection.accountId ?? null,
    organizationId: inspection.tokenDetails?.organizationId ?? null,
    tokenExpiresAtMs: tokenExpiresAtMs ?? null,
    tokenExpiresAtIso: tokenExpiresAtMs ? new Date(tokenExpiresAtMs).toISOString() : null,
    tokenExpiresInMs: tokenExpiresAtMs ? Math.max(0, tokenExpiresAtMs - referenceMs) : null,
    lastRefreshAtMs: inspection.lastRefreshAtMs ?? null,
    lastRefreshAtIso: inspection.lastRefreshAtMs
      ? new Date(inspection.lastRefreshAtMs).toISOString()
      : null,
    lastAttemptAtMs: status.lastAttemptAtMs ?? null,
    lastAttemptAtIso: status.lastAttemptAtMs
      ? new Date(status.lastAttemptAtMs).toISOString()
      : null,
    lastSuccessAtMs: status.lastSuccessAtMs ?? null,
    lastSuccessAtIso: status.lastSuccessAtMs
      ? new Date(status.lastSuccessAtMs).toISOString()
      : null,
    lastQuotaAtMs: status.lastQuotaAtMs ?? null,
    lastQuotaAtIso: status.lastQuotaAtMs
      ? new Date(status.lastQuotaAtMs).toISOString()
      : null,
    cooldownUntilMs: cooldownUntilMs ?? null,
    cooldownUntilIso: cooldownUntilMs
      ? new Date(cooldownUntilMs).toISOString()
      : null,
    cooldownRemainingMs,
    consecutiveFailures: status.consecutiveFailures ?? 0,
    lastError: status.lastError ?? null,
    accountDir: inspection.accountDir,
    authFilePath: inspection.authFilePath
  };
}

function renderAccountDetails(inspections: AccountInspection[], referenceMs = Date.now()): void {
  const indent = "  ";

  for (const inspection of inspections) {
    const marker = inspection.isDefault ? "*" : " ";
    const status = inspection.status ?? {};
    const loginStatus = inspection.loggedIn ? "logged-in" : "not-logged-in";

    process.stdout.write(`${marker} ${inspection.name}\n`);
    process.stdout.write(`${indent}status: ${loginStatus}\n`);
    process.stdout.write(`${indent}account_id: ${inspection.accountId ?? "(unknown)"}\n`);
    process.stdout.write(
      `${indent}organization_id: ${inspection.tokenDetails?.organizationId ?? "(unknown)"}\n`
    );
    process.stdout.write(
      `${indent}token_expires_at: ${formatTimestampWithRelative(
        inspection.tokenDetails?.expiresAtMs,
        referenceMs
      )}\n`
    );
    process.stdout.write(
      `${indent}last_refresh_at: ${formatTimestampWithRelative(inspection.lastRefreshAtMs, referenceMs)}\n`
    );
    process.stdout.write(
      `${indent}last_attempt_at: ${formatTimestampWithRelative(status.lastAttemptAtMs, referenceMs)}\n`
    );
    process.stdout.write(
      `${indent}last_success_at: ${formatTimestampWithRelative(status.lastSuccessAtMs, referenceMs)}\n`
    );
    process.stdout.write(
      `${indent}last_quota_at: ${formatTimestampWithRelative(status.lastQuotaAtMs, referenceMs)}\n`
    );
    process.stdout.write(
      `${indent}cooldown_until: ${formatCooldown(status.cooldownUntilMs, referenceMs)}\n`
    );
    process.stdout.write(
      `${indent}consecutive_failures: ${status.consecutiveFailures ?? 0}\n`
    );
    process.stdout.write(`${indent}last_error: ${status.lastError ?? "none"}\n`);
    process.stdout.write(`${indent}account_dir: ${inspection.accountDir}\n`);
    process.stdout.write("\n");
  }
}

function renderAccountDetailsJson(inspections: AccountInspection[]): void {
  const referenceMs = Date.now();
  const payload = inspections.map((inspection) => toAccountDetailRecord(inspection, referenceMs));
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function renderDoctorJson(
  inspections: AccountInspection[],
  summary: ReturnType<typeof summarizeHealth>,
  options: HealthCheckOptions
): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds: options,
    totals: {
      accounts: inspections.length,
      ok: summary.okCount,
      warnings: summary.warnCount,
      errors: summary.errorCount
    },
    issues: summary.issues
  };

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function renderDoctorReport(
  inspections: AccountInspection[],
  summary: ReturnType<typeof summarizeHealth>,
  options: HealthCheckOptions
): void {
  process.stdout.write("Account health check\n");
  process.stdout.write(
    `Thresholds: expires_within=${options.expiresWithinHours}h, max_failures=${options.maxFailures}\n`
  );
  process.stdout.write(
    `Totals: ${summary.okCount} ok, ${summary.warnCount} warnings, ${summary.errorCount} errors\n\n`
  );

  if (summary.issues.length === 0) {
    process.stdout.write("All accounts look healthy.\n");
    return;
  }

  const issuesByAccount = new Map<string, typeof summary.issues>();
  for (const issue of summary.issues) {
    const list = issuesByAccount.get(issue.account) ?? [];
    list.push(issue);
    issuesByAccount.set(issue.account, list);
  }

  for (const inspection of inspections) {
    const issues = issuesByAccount.get(inspection.name);
    const marker = inspection.isDefault ? "*" : " ";

    if (!issues || issues.length === 0) {
      process.stdout.write(`${marker} ${inspection.name}: OK\n`);
      continue;
    }

    const worstSeverity = issues.some((issue) => issue.severity === "error") ? "ERROR" : "WARN";
    process.stdout.write(`${marker} ${inspection.name}: ${worstSeverity}\n`);

    for (const issue of issues) {
      process.stdout.write(`  - [${issue.severity}] ${issue.code}: ${issue.message}\n`);
    }
  }
}

function renderAccountReportMarkdown(inspections: AccountInspection[]): void {
  const referenceMs = Date.now();
  const header = [
    "| Account | Default | Login | Token Expires | Cooldown | Last Quota | Failures |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];

  const rows = inspections.map((inspection) => {
    const status = inspection.status ?? {};
    const login = inspection.loggedIn ? "logged-in" : "not-logged-in";
    const expires = formatExpiryShort(inspection.tokenDetails?.expiresAtMs, referenceMs);
    const cooldown = formatCooldownShort(status.cooldownUntilMs, referenceMs);
    const lastQuota = formatRelativeShort(status.lastQuotaAtMs, referenceMs);

    return `| ${inspection.name} | ${inspection.isDefault ? "yes" : "no"} | ${login} | ${expires} | ${cooldown} | ${lastQuota} | ${status.consecutiveFailures ?? 0} |`;
  });

  process.stdout.write(`# CAO Account Report\n\n`);
  process.stdout.write(`Generated: ${new Date(referenceMs).toISOString()}\n\n`);
  process.stdout.write(header.join("\n") + "\n");
  process.stdout.write(rows.join("\n") + "\n");
}

function renderAccountReportJson(inspections: AccountInspection[]): void {
  const referenceMs = Date.now();
  const payload = inspections.map((inspection) => toAccountDetailRecord(inspection, referenceMs));
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date(referenceMs).toISOString(),
        accounts: payload
      },
      null,
      2
    ) + "\n"
  );
}

function renderAccountPretty(inspections: AccountInspection[], baseDir: string): void {
  const referenceMs = Date.now();
  const health = summarizeHealth(inspections, DEFAULT_HEALTH_OPTIONS, referenceMs);
  const width = resolvePrettyWidth();
  const title = "CAO Status";

  writeBoxTop(width, title);
  writeBoxLine(width, `Generated: ${new Date(referenceMs).toISOString()}`);
  writeBoxLine(width, `Base dir: ${truncateMiddle(baseDir, width - 4)}`);
  writeBoxLine(
    width,
    `Accounts: ${inspections.length} (ok ${health.okCount}, warn ${health.warnCount}, error ${health.errorCount})`
  );
  writeBoxDivider(width, "Accounts");

  const issuesByAccount = new Map<string, string[]>();
  for (const issue of health.issues) {
    const list = issuesByAccount.get(issue.account) ?? [];
    list.push(`[${issue.severity}] ${issue.code}`);
    issuesByAccount.set(issue.account, list);
  }

  for (const inspection of inspections) {
    const status = inspection.status ?? {};
    const marker = inspection.isDefault ? "*" : " ";
    const loginStatus = inspection.loggedIn ? "logged-in" : "not-logged-in";
    const expires = formatExpiryShort(inspection.tokenDetails?.expiresAtMs, referenceMs);
    const cooldown = formatCooldownShort(status.cooldownUntilMs, referenceMs);
    const lastQuota = formatRelativeShort(status.lastQuotaAtMs, referenceMs);
    const failures = status.consecutiveFailures ?? 0;
    const issues = issuesByAccount.get(inspection.name);
    const statusBadge = colorStatusBadge(inspection, issues);

    const summary = `${marker} ${inspection.name} ${statusBadge} | expires: ${expires} | cooldown: ${cooldown} | last_quota: ${lastQuota} | failures: ${failures}`;
    writeBoxLine(width, summary);

    if (issues && issues.length > 0) {
      writeBoxLine(width, `  issues: ${issues.join(", ")}`);
    }

    writeBoxLine(width, `  login: ${loginStatus} | account_id: ${inspection.accountId ?? "unknown"}`);
  }

  writeBoxBottom(width);
}

function renderAccountCompact(inspections: AccountInspection[]): void {
  const referenceMs = Date.now();

  for (const inspection of inspections) {
    const marker = inspection.isDefault ? "*" : " ";
    const status = inspection.status ?? {};
    const loginStatus = inspection.loggedIn ? "logged-in" : "not-logged-in";
    const expires = formatExpiryShort(inspection.tokenDetails?.expiresAtMs, referenceMs);
    const lastQuota = formatRelativeShort(status.lastQuotaAtMs, referenceMs);
    const cooldown = formatCooldownShort(status.cooldownUntilMs, referenceMs);

    process.stdout.write(
      `${marker} ${inspection.name} (${loginStatus}) | expires: ${expires} | cooldown: ${cooldown} | last_quota: ${lastQuota} | failures: ${status.consecutiveFailures ?? 0}\n`
    );
  }
}

function resolvePrettyWidth(): number {
  if (!process.stdout.isTTY) {
    return 88;
  }

  const columns = process.stdout.columns ?? 88;
  return Math.min(Math.max(columns, 72), 120);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 5) {
    return value.slice(0, maxLength);
  }

  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function truncateTail(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function padLine(content: string, width: number): string {
  const visibleLength = stripAnsi(content).length;
  const maxContent = width - 4;
  const safeContent =
    visibleLength > maxContent ? truncateTail(stripAnsi(content), maxContent) : content;
  const paddedLength = stripAnsi(safeContent).length;
  const padding = Math.max(0, maxContent - paddedLength);
  return `│ ${safeContent}${" ".repeat(padding)} │`;
}

function writeBoxTop(width: number, title: string): void {
  const line = "─".repeat(width - 2);
  const label = ` ${title} `;
  const start = Math.max(0, Math.floor((line.length - label.length) / 2));
  const withLabel = line.slice(0, start) + label + line.slice(start + label.length);
  process.stdout.write(`┌${withLabel}┐\n`);
}

function writeBoxDivider(width: number, label?: string): void {
  if (!label) {
    process.stdout.write(`├${"─".repeat(width - 2)}┤\n`);
    return;
  }

  const line = "─".repeat(width - 2);
  const title = ` ${label} `;
  const start = Math.max(0, Math.floor((line.length - title.length) / 2));
  const withLabel = line.slice(0, start) + title + line.slice(start + title.length);
  process.stdout.write(`├${withLabel}┤\n`);
}

function writeBoxLine(width: number, content: string): void {
  process.stdout.write(`${padLine(content, width)}\n`);
}

function writeBoxBottom(width: number): void {
  process.stdout.write(`└${"─".repeat(width - 2)}┘\n`);
}

function colorStatusBadge(inspection: AccountInspection, issues?: string[]): string {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const severity = issues?.some((issue) => issue.includes("[error]"))
    ? "error"
    : issues?.length
      ? "warn"
      : inspection.loggedIn
        ? "ok"
        : "error";

  const text = severity === "ok" ? "OK" : severity === "warn" ? "WARN" : "ERROR";

  if (!useColor) {
    return `[${text}]`;
  }

  const color =
    severity === "ok" ? "\x1b[32m" : severity === "warn" ? "\x1b[33m" : "\x1b[31m";
  return `${color}[${text}]\x1b[0m`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatTimestampWithRelative(timestampMs: number | undefined, referenceMs: number): string {
  if (!timestampMs) {
    return "(unknown)";
  }

  const iso = new Date(timestampMs).toISOString();
  const diffMs = timestampMs - referenceMs;

  if (Math.abs(diffMs) < 5_000) {
    return `${iso} (now)`;
  }

  const relative =
    diffMs > 0 ? `in ${formatDuration(diffMs)}` : `${formatDuration(-diffMs)} ago`;
  return `${iso} (${relative})`;
}

function formatRelativeShort(timestampMs: number | undefined, referenceMs: number): string {
  if (!timestampMs) {
    return "none";
  }

  const diffMs = timestampMs - referenceMs;
  if (diffMs <= 0) {
    return `${formatDuration(-diffMs)} ago`;
  }

  return `in ${formatDuration(diffMs)}`;
}

function formatExpiryShort(timestampMs: number | undefined, referenceMs: number): string {
  if (!timestampMs) {
    return "unknown";
  }

  const diffMs = timestampMs - referenceMs;

  if (diffMs <= 0) {
    return "expired";
  }

  return `in ${formatDuration(diffMs)}`;
}

function formatCooldownShort(timestampMs: number | undefined, referenceMs: number): string {
  if (!timestampMs || timestampMs <= referenceMs) {
    return "none";
  }

  return `in ${formatDuration(timestampMs - referenceMs)}`;
}

function formatCooldown(cooldownUntilMs: number | undefined, referenceMs: number): string {
  if (!cooldownUntilMs) {
    return "none";
  }

  if (cooldownUntilMs <= referenceMs) {
    const iso = new Date(cooldownUntilMs).toISOString();
    return `${iso} (elapsed)`;
  }

  return formatTimestampWithRelative(cooldownUntilMs, referenceMs);
}

function buildGatewayOverrides(options: GatewayStartOptions): Partial<GatewayConfig> {
  const overrides: Partial<GatewayConfig> = {};

  overrides.bindAddress = options.bind;
  overrides.baseUrl = options.baseUrl;
  overrides.overrideAuth = !options.passthroughAuth;

  const port = Number.parseInt(options.port, 10);
  if (!Number.isNaN(port)) {
    overrides.port = port;
  }

  const cooldown = Number.parseInt(options.cooldownSeconds, 10);
  if (!Number.isNaN(cooldown)) {
    overrides.cooldownSeconds = cooldown;
  }

  const maxRetries = Number.parseInt(options.maxRetryPasses, 10);
  if (!Number.isNaN(maxRetries)) {
    overrides.maxRetryPasses = maxRetries;
  }

  const timeout = Number.parseInt(options.timeoutMs, 10);
  if (!Number.isNaN(timeout)) {
    overrides.requestTimeoutMs = timeout;
  }

  const upstreamRetries = Number.parseInt(options.upstreamRetries, 10);
  if (!Number.isNaN(upstreamRetries)) {
    overrides.upstreamMaxRetries = upstreamRetries;
  }

  const upstreamRetryBaseMs = Number.parseInt(options.upstreamRetryBaseMs, 10);
  if (!Number.isNaN(upstreamRetryBaseMs)) {
    overrides.upstreamRetryBaseMs = upstreamRetryBaseMs;
  }

  const upstreamRetryMaxMs = Number.parseInt(options.upstreamRetryMaxMs, 10);
  if (!Number.isNaN(upstreamRetryMaxMs)) {
    overrides.upstreamRetryMaxMs = upstreamRetryMaxMs;
  }

  const upstreamRetryJitterMs = Number.parseInt(options.upstreamRetryJitterMs, 10);
  if (!Number.isNaN(upstreamRetryJitterMs)) {
    overrides.upstreamRetryJitterMs = upstreamRetryJitterMs;
  }

  return overrides;
}

async function runWithFallback(
  options: RunOptions,
  baseDir: string,
  accounts: string[],
  codexArgs: string[]
): Promise<void> {
  const codexBin = options.codex;
  const gatewayUrl = options.gateway ? options.gatewayUrl : undefined;
  const fallbackEnabled = options.fallback && !options.gateway;
  const maxPasses = normalizeMaxPasses(options.maxPasses);
  const retryDelayMs = normalizeDelay(options.retryDelay);

  if (options.gateway && gatewayUrl) {
    process.stderr.write(`Gateway routing enabled: ${gatewayUrl}\n`);
    if (options.fallback) {
      process.stderr.write("Gateway mode disables CLI fallback (handled by gateway).\n");
    }
  }

  for (let passIndex = 0; passIndex < maxPasses; passIndex += 1) {
    let quotaFailures = 0;
    let lastExitCode = 1;

    for (let index = 0; index < accounts.length; index += 1) {
      const name = accounts[index];
      const accountDir = ensureAccountDir(baseDir, name);
      ensureAccountConfig(accountDir);
      const attemptAtMs = Date.now();

      updateAccountStatus(baseDir, name, (previous) => ({
        ...previous,
        lastAttemptAtMs: attemptAtMs
      }));

      process.stderr.write(`Using account: ${name}\n`);

      const result = await runCodexOnce(
        codexBin,
        codexArgs,
        accountDir,
        fallbackEnabled,
        gatewayUrl ? { OPENAI_BASE_URL: gatewayUrl } : {}
      );
      lastExitCode = result.exitCode;

      if (result.exitCode === 0) {
        updateAccountStatus(baseDir, name, (previous) => ({
          ...previous,
          lastAttemptAtMs: attemptAtMs,
          lastSuccessAtMs: Date.now(),
          consecutiveFailures: 0,
          cooldownUntilMs: undefined,
          lastError: undefined
        }));
        process.exit(0);
        return;
      }

      if (!fallbackEnabled) {
        updateAccountStatus(baseDir, name, (previous) => ({
          ...previous,
          lastAttemptAtMs: attemptAtMs,
          consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
          cooldownUntilMs: undefined,
          lastError: `exit_code_${result.exitCode}`
        }));
        process.exit(result.exitCode);
        return;
      }

      if (!result.quotaError) {
        updateAccountStatus(baseDir, name, (previous) => ({
          ...previous,
          lastAttemptAtMs: attemptAtMs,
          consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
          cooldownUntilMs: undefined,
          lastError: `exit_code_${result.exitCode}`
        }));
        process.exit(result.exitCode);
        return;
      }

      quotaFailures += 1;
      const quotaAtMs = Date.now();
      const cooldownUntilMs = retryDelayMs > 0 ? quotaAtMs + retryDelayMs : undefined;

      updateAccountStatus(baseDir, name, (previous) => ({
        ...previous,
        lastAttemptAtMs: attemptAtMs,
        lastQuotaAtMs: quotaAtMs,
        cooldownUntilMs,
        consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
        lastError: "usage_limit_reached"
      }));
      const nextName = accounts[index + 1];

      if (nextName) {
        process.stderr.write(`Quota exhausted. Falling back to: ${nextName}\n`);
      }
    }

    if (!fallbackEnabled) {
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
