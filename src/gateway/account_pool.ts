import fs from "fs";
import path from "path";

import { updateAccountStatus } from "../account_status_store";
import { getAccountDir } from "../paths";
import { loadRegistry } from "../registry_store";
import { getAccountOrder } from "../account_manager";
import { TokenPair, deriveTokenDetails, isTokenFresh } from "./token_utils";

interface AccountTokensFile {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

export interface AccountState {
  name: string;
  accountDir: string;
  tokens: TokenPair;
  cooldownUntilMs: number;
  lastError?: string;
  consecutiveFailures: number;
}

export class AccountPool {
  private readonly baseDir: string;
  private readonly accounts: AccountState[];
  private readonly sessionAssignments = new Map<string, string>();

  constructor(baseDir: string, accounts: AccountState[]) {
    this.baseDir = baseDir;
    this.accounts = accounts;
  }

  static loadFromRegistry(baseDir: string): AccountPool {
    const registry = loadRegistry(baseDir);
    const orderedAccounts = getAccountOrder(registry);
    const accounts: AccountState[] = [];

    for (const name of orderedAccounts) {
      const accountDir = getAccountDir(baseDir, name);
      const tokens = loadTokens(accountDir);

      if (!tokens) {
        continue;
      }

      accounts.push({
        name,
        accountDir,
        tokens,
        cooldownUntilMs: 0,
        consecutiveFailures: 0
      });
    }

    return new AccountPool(baseDir, accounts);
  }

  getAccounts(): AccountState[] {
    return this.accounts;
  }

  getStickyAccount(sessionKey: string): AccountState | undefined {
    const assigned = this.sessionAssignments.get(sessionKey);

    if (!assigned) {
      return undefined;
    }

    return this.accounts.find((account) => account.name === assigned);
  }

  assignAccount(sessionKey: string, accountName: string): void {
    this.sessionAssignments.set(sessionKey, accountName);
  }

  clearAssignment(sessionKey: string): void {
    this.sessionAssignments.delete(sessionKey);
  }

  pickNextAvailable(excluded: Set<string>): AccountState | undefined {
    const now = Date.now();

    for (const account of this.accounts) {
      if (excluded.has(account.name)) {
        continue;
      }

      if (account.cooldownUntilMs > now) {
        continue;
      }

      return account;
    }

    return undefined;
  }

  markAttempt(account: AccountState): void {
    const attemptAtMs = Date.now();

    updateAccountStatus(this.baseDir, account.name, (previous) => ({
      ...previous,
      lastAttemptAtMs: attemptAtMs
    }));
  }

  markQuota(account: AccountState, cooldownSeconds: number, resetsAtMs?: number): void {
    const quotaAtMs = Date.now();
    account.consecutiveFailures += 1;
    account.lastError = "usage_limit_reached";
    const until =
      resetsAtMs && resetsAtMs > quotaAtMs ? resetsAtMs : quotaAtMs + cooldownSeconds * 1000;
    account.cooldownUntilMs = until;

    updateAccountStatus(this.baseDir, account.name, (previous) => ({
      ...previous,
      lastAttemptAtMs: quotaAtMs,
      lastQuotaAtMs: quotaAtMs,
      cooldownUntilMs: until,
      consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
      lastError: "usage_limit_reached"
    }));
  }

  markAuthFailure(account: AccountState, message: string): void {
    const failureAtMs = Date.now();
    const cooldownUntilMs = failureAtMs + 60 * 1000;
    account.consecutiveFailures += 1;
    account.lastError = message;
    account.cooldownUntilMs = cooldownUntilMs;

    updateAccountStatus(this.baseDir, account.name, (previous) => ({
      ...previous,
      lastAttemptAtMs: failureAtMs,
      cooldownUntilMs,
      consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
      lastError: message
    }));
  }

  markSuccess(account: AccountState): void {
    const successAtMs = Date.now();
    account.consecutiveFailures = 0;
    account.lastError = undefined;

    updateAccountStatus(this.baseDir, account.name, (previous) => ({
      ...previous,
      lastAttemptAtMs: successAtMs,
      lastSuccessAtMs: successAtMs,
      consecutiveFailures: 0,
      cooldownUntilMs: undefined,
      lastError: undefined
    }));
  }

  updateTokens(account: AccountState, tokens: TokenPair): void {
    account.tokens = tokens;
    persistTokens(account.accountDir, tokens);

    updateAccountStatus(this.baseDir, account.name, (previous) => ({
      ...previous,
      lastSuccessAtMs: Date.now(),
      consecutiveFailures: 0,
      cooldownUntilMs: undefined,
      lastError: undefined
    }));
  }

  isTokenFresh(account: AccountState, bufferSeconds: number): boolean {
    return isTokenFresh(account.tokens.expiresAtMs, bufferSeconds);
  }
}

function loadTokens(accountDir: string): TokenPair | undefined {
  const authPath = path.join(accountDir, "auth.json");

  if (!fs.existsSync(authPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(authPath, "utf8");
  let data: AccountTokensFile;

  try {
    data = JSON.parse(raw) as AccountTokensFile;
  } catch (error) {
    process.stderr.write(
      `Warning: auth.json for ${accountDir} is invalid and will be skipped.\n`
    );
    return undefined;
  }
  const tokens = data.tokens ?? {};

  if (!tokens.access_token || !tokens.refresh_token) {
    return undefined;
  }

  const details = deriveTokenDetails(tokens.access_token, tokens.id_token);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accountId: tokens.account_id ?? details.chatgptAccountId,
    ...details
  };
}

function persistTokens(accountDir: string, tokens: TokenPair): void {
  const authPath = path.join(accountDir, "auth.json");
  const data: AccountTokensFile = {
    OPENAI_API_KEY: null,
    tokens: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      id_token: tokens.idToken,
      account_id: tokens.accountId
    },
    last_refresh: new Date().toISOString()
  };

  fs.writeFileSync(authPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
