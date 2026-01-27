import fs from "fs";
import path from "path";

import { loadAccountStatuses, type AccountStatus } from "./account_status_store";
import { getAccountDir } from "./paths";
import { AUTH_FILE_NAME } from "./constants";
import { loadRegistry } from "./registry_store";
import { deriveTokenDetails, type TokenDetails } from "./gateway/token_utils";

interface AccountTokensFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

export interface AccountInspection {
  name: string;
  isDefault: boolean;
  accountDir: string;
  authFilePath: string;
  loggedIn: boolean;
  lastRefreshAtMs?: number;
  accountId?: string;
  tokenDetails?: TokenDetails;
  status?: AccountStatus;
}

function parseLastRefresh(lastRefresh: unknown): number | undefined {
  if (typeof lastRefresh !== "string" || lastRefresh.trim().length === 0) {
    return undefined;
  }

  const ms = Date.parse(lastRefresh);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function loadAuthInspection(accountDir: string): {
  loggedIn: boolean;
  lastRefreshAtMs?: number;
  accountId?: string;
  tokenDetails?: TokenDetails;
} {
  const authFilePath = path.join(accountDir, AUTH_FILE_NAME);

  if (!fs.existsSync(authFilePath)) {
    return { loggedIn: false };
  }

  let parsed: AccountTokensFile;

  try {
    const raw = fs.readFileSync(authFilePath, "utf8");
    parsed = JSON.parse(raw) as AccountTokensFile;
  } catch {
    return { loggedIn: false };
  }

  const accessToken = parsed.tokens?.access_token;
  const idToken = parsed.tokens?.id_token;

  if (!accessToken || typeof accessToken !== "string") {
    return { loggedIn: false };
  }

  const tokenDetails = deriveTokenDetails(accessToken, idToken);
  const lastRefreshAtMs = parseLastRefresh(parsed.last_refresh);

  return {
    loggedIn: true,
    lastRefreshAtMs,
    accountId: parsed.tokens?.account_id ?? tokenDetails.chatgptAccountId,
    tokenDetails
  };
}

export function inspectAccounts(baseDir: string): AccountInspection[] {
  const registry = loadRegistry(baseDir);

  if (registry.accounts.length === 0) {
    return [];
  }

  const statuses = loadAccountStatuses(baseDir);
  const inspections: AccountInspection[] = [];

  for (const name of registry.accounts) {
    const accountDir = getAccountDir(baseDir, name);
    const authFilePath = path.join(accountDir, AUTH_FILE_NAME);
    const authInspection = loadAuthInspection(accountDir);
    const status = statuses[name];

    inspections.push({
      name,
      isDefault: registry.default_account === name,
      accountDir,
      authFilePath,
      loggedIn: authInspection.loggedIn,
      lastRefreshAtMs: authInspection.lastRefreshAtMs,
      accountId: authInspection.accountId,
      tokenDetails: authInspection.tokenDetails,
      status
    });
  }

  return inspections;
}
