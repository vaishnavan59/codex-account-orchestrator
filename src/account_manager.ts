import fs from "fs";
import path from "path";

import { deleteAccountStatus, updateAccountStatus } from "./account_status_store";
import { DEFAULT_CONFIG_TOML } from "./constants";
import { getAccountDir } from "./paths";
import { loadRegistry, Registry, saveRegistry } from "./registry_store";

export function validateAccountName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new Error("Account name cannot be empty.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error("Account name must use letters, numbers, underscores, or hyphens only.");
  }

  return trimmed;
}

export function ensureBaseDir(baseDir: string): void {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
}

export function ensureAccountDir(baseDir: string, accountName: string): string {
  const accountDir = getAccountDir(baseDir, accountName);

  if (!fs.existsSync(accountDir)) {
    fs.mkdirSync(accountDir, { recursive: true });
  }

  return accountDir;
}

export function ensureAccountConfig(accountDir: string): void {
  const configPath = path.join(accountDir, "config.toml");

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, DEFAULT_CONFIG_TOML, "utf8");
  }
}

export function addAccount(baseDir: string, accountName: string): Registry {
  ensureBaseDir(baseDir);

  const registry = loadRegistry(baseDir);
  const normalizedName = validateAccountName(accountName);

  ensureAccountConfig(ensureAccountDir(baseDir, normalizedName));

  if (!registry.accounts.includes(normalizedName)) {
    registry.accounts.push(normalizedName);
  }

  if (!registry.default_account) {
    registry.default_account = normalizedName;
  }

  updateAccountStatus(baseDir, normalizedName, () => ({}));
  saveRegistry(baseDir, registry);

  return registry;
}

export function setDefaultAccount(baseDir: string, accountName: string): Registry {
  ensureBaseDir(baseDir);

  const registry = loadRegistry(baseDir);
  const normalizedName = validateAccountName(accountName);

  if (!registry.accounts.includes(normalizedName)) {
    throw new Error(`Account not found: ${normalizedName}`);
  }

  registry.default_account = normalizedName;
  saveRegistry(baseDir, registry);

  return registry;
}

export function removeAccount(
  baseDir: string,
  accountName: string,
  removeFiles: boolean
): Registry {
  ensureBaseDir(baseDir);

  const registry = loadRegistry(baseDir);
  const normalizedName = validateAccountName(accountName);
  const index = registry.accounts.indexOf(normalizedName);

  if (index === -1) {
    throw new Error(`Account not found: ${normalizedName}`);
  }

  registry.accounts.splice(index, 1);

  if (registry.default_account === normalizedName) {
    registry.default_account = registry.accounts.length > 0 ? registry.accounts[0] : null;
  }

  if (removeFiles) {
    const accountDir = getAccountDir(baseDir, normalizedName);

    if (fs.existsSync(accountDir)) {
      fs.rmSync(accountDir, { recursive: true, force: true });
    }
  }

  deleteAccountStatus(baseDir, normalizedName);
  saveRegistry(baseDir, registry);

  return registry;
}

export function getAccountOrder(registry: Registry): string[] {
  if (registry.accounts.length === 0) {
    return [];
  }

  const defaultName = registry.default_account;

  if (!defaultName) {
    return [...registry.accounts];
  }

  const rest = registry.accounts.filter((name) => name !== defaultName);
  return [defaultName, ...rest];
}
