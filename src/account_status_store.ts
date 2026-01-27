import fs from "fs";
import path from "path";

import { getAccountStatusPath } from "./paths";

export interface AccountStatus {
  lastAttemptAtMs?: number;
  lastSuccessAtMs?: number;
  lastQuotaAtMs?: number;
  cooldownUntilMs?: number;
  consecutiveFailures?: number;
  lastError?: string;
}

export interface AccountStatusRegistry {
  statuses: Record<string, AccountStatus>;
}

function createEmptyRegistry(): AccountStatusRegistry {
  return { statuses: {} };
}

function sanitizeTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function sanitizeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.floor(value);
}

function sanitizeStatus(status: AccountStatus | undefined): AccountStatus {
  if (!status) {
    return {};
  }

  const lastAttemptAtMs = sanitizeTimestamp(status.lastAttemptAtMs);
  const lastSuccessAtMs = sanitizeTimestamp(status.lastSuccessAtMs);
  const lastQuotaAtMs = sanitizeTimestamp(status.lastQuotaAtMs);
  const cooldownUntilMs = sanitizeTimestamp(status.cooldownUntilMs);
  const consecutiveFailures = sanitizeCount(status.consecutiveFailures);
  const lastError =
    typeof status.lastError === "string" && status.lastError.trim().length > 0
      ? status.lastError.trim()
      : undefined;

  return {
    lastAttemptAtMs,
    lastSuccessAtMs,
    lastQuotaAtMs,
    cooldownUntilMs,
    consecutiveFailures,
    lastError
  };
}

function normalizeStatuses(
  statuses: Record<string, AccountStatus> | undefined
): Record<string, AccountStatus> {
  if (!statuses || typeof statuses !== "object") {
    return {};
  }

  const normalized: Record<string, AccountStatus> = {};

  for (const [name, status] of Object.entries(statuses)) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      continue;
    }

    normalized[trimmedName] = sanitizeStatus(status);
  }

  return normalized;
}

/**
 * Loads the persisted per-account status registry. If the file is missing or
 * invalid, a safe empty registry is returned.
 */
export function loadAccountStatusRegistry(baseDir: string): AccountStatusRegistry {
  const statusPath = getAccountStatusPath(baseDir);

  if (!fs.existsSync(statusPath)) {
    return createEmptyRegistry();
  }

  const raw = fs.readFileSync(statusPath, "utf8");

  try {
    const parsed = JSON.parse(raw) as AccountStatusRegistry;
    return { statuses: normalizeStatuses(parsed.statuses) };
  } catch {
    const backupPath = `${statusPath}.corrupt-${Date.now()}`;
    fs.writeFileSync(backupPath, raw, "utf8");
    process.stderr.write(
      `Warning: account status file was invalid and has been backed up to ${backupPath}.\n`
    );
    return createEmptyRegistry();
  }
}

export function loadAccountStatuses(baseDir: string): Record<string, AccountStatus> {
  const registry = loadAccountStatusRegistry(baseDir);
  return { ...registry.statuses };
}

function saveAccountStatusRegistry(baseDir: string, registry: AccountStatusRegistry): void {
  const statusPath = getAccountStatusPath(baseDir);
  const dir = path.dirname(statusPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload = JSON.stringify(registry, null, 2) + "\n";
  fs.writeFileSync(statusPath, payload, "utf8");
}

export function getAccountStatus(baseDir: string, accountName: string): AccountStatus | undefined {
  const registry = loadAccountStatusRegistry(baseDir);
  return registry.statuses[accountName];
}

/**
 * Updates the stored status for a single account using a functional updater
 * to avoid accidental partial writes.
 */
export function updateAccountStatus(
  baseDir: string,
  accountName: string,
  updater: (previous: AccountStatus) => AccountStatus
): AccountStatus {
  const registry = loadAccountStatusRegistry(baseDir);
  const previous = sanitizeStatus(registry.statuses[accountName]);
  const next = sanitizeStatus(updater(previous));

  registry.statuses[accountName] = next;
  saveAccountStatusRegistry(baseDir, registry);

  return next;
}

export function deleteAccountStatus(baseDir: string, accountName: string): void {
  const registry = loadAccountStatusRegistry(baseDir);

  if (!(accountName in registry.statuses)) {
    return;
  }

  delete registry.statuses[accountName];
  saveAccountStatusRegistry(baseDir, registry);
}
