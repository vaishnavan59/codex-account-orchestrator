import fs from "fs";
import { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";

import { AccountPool, AccountState } from "./account_pool";
import { GatewayConfig } from "./gateway_config";
import { TokenPair, deriveTokenDetails, parseJwtSessionId } from "./token_utils";

const TOKEN_REFRESH_BUFFER_SECONDS = 90;

export class OpenAiGateway {
  private readonly pool: AccountPool;
  private readonly config: GatewayConfig;
  private readonly inFlightRefresh = new Map<string, Promise<TokenPair>>();

  constructor(pool: AccountPool, config: GatewayConfig) {
    this.pool = pool;
    this.config = config;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const clientAbort = new AbortController();
    const abortHandler = () => clientAbort.abort();
    req.once("aborted", abortHandler);
    res.once("close", abortHandler);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    const body = await readBody(req);
    logRequestDebug(req, body);
    const sessionKey = resolveSessionKey(req);

    const excluded = new Set<string>();
    let attempts = 0;

    while (attempts < this.config.maxRetryPasses + this.pool.getAccounts().length) {
      if (clientAbort.signal.aborted) {
        return;
      }
      attempts += 1;

      const selected = this.selectAccount(sessionKey, excluded);
      if (!selected) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "all_accounts_exhausted" }));
        return;
      }

      process.stdout.write(
        `Gateway: ${req.method ?? "REQ"} ${url.pathname} -> ${selected.name}\n`
      );

      const response = await this.forwardRequest(selected, req, body, clientAbort.signal);

      if (response.aborted || clientAbort.signal.aborted) {
        return;
      }

      if (response.ok) {
        this.pool.markSuccess(selected);
        await streamResponse(res, response.response!);
        return;
      }

      if (response.quota) {
        excluded.add(selected.name);
        this.pool.markQuota(selected, this.config.cooldownSeconds, response.resetAtMs);
        this.pool.clearAssignment(sessionKey);
        process.stdout.write(`Gateway: quota hit, switching from ${selected.name}\n`);
        continue;
      }

      if (response.authFailure) {
        excluded.add(selected.name);
        this.pool.markAuthFailure(selected, "auth_failed");
        this.pool.clearAssignment(sessionKey);
        const detail = response.bodyText ? truncate(response.bodyText, 200) : "unknown";
        process.stdout.write(`Gateway: auth failure on ${selected.name} (${detail})\n`);
        continue;
      }

      process.stdout.write(
        `Gateway: upstream error ${response.status} on ${selected.name}\n`
      );

      await writeErrorResponse(res, response.status, response.bodyText);
      return;
    }

    res.writeHead(500).end("gateway_exhausted");
  }

  private selectAccount(sessionKey: string, excluded: Set<string>): AccountState | undefined {
    const sticky = this.pool.getStickyAccount(sessionKey);

    if (sticky && !excluded.has(sticky.name) && sticky.cooldownUntilMs <= Date.now()) {
      return sticky;
    }

    const picked = this.pool.pickNextAvailable(excluded);

    if (picked) {
      this.pool.assignAccount(sessionKey, picked.name);
    }

    return picked;
  }

  private async forwardRequest(
    account: AccountState,
    req: IncomingMessage,
    body: Buffer,
    abortSignal: AbortSignal
  ): Promise<ForwardResult> {
    const targetUrl = buildTargetUrl(this.config.baseUrl, req.url ?? "");

    if (shouldForceQuota(account.name)) {
      return {
        ok: false,
        status: 429,
        authFailure: false,
        quota: true,
        bodyText: "forced_quota"
      };
    }
    const accessToken = this.config.overrideAuth ? await this.ensureAccessToken(account) : undefined;

    if (this.config.overrideAuth && !accessToken) {
      return {
        ok: false,
        status: 401,
        authFailure: true,
        quota: false,
        bodyText: "missing_access_token"
      };
    }

    const attempt = async (token?: string): Promise<ForwardResult> => {
      const headers = buildForwardHeaders(req, account, token, this.config);
      return this.fetchWithRetry(targetUrl, req.method, headers, body, abortSignal);
    };

    let response = await attempt(accessToken);

    if (response.authFailure && this.config.overrideAuth && account.tokens.idToken) {
      process.stdout.write(`Gateway: access token rejected for ${account.name}, trying id_token\n`);
      response = await attempt(account.tokens.idToken);
    }

    return response;
  }

  private async fetchOnce(
    targetUrl: URL,
    method: string | undefined,
    headers: Headers,
    body: Buffer,
    externalSignal?: AbortSignal
  ): Promise<ForwardResult> {
    logUpstreamDebug(method ?? "REQ", targetUrl, headers);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(targetUrl, {
        method,
        headers,
        body: body.length > 0 ? (body as unknown as BodyInit) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: response.status,
          authFailure: true,
          quota: false,
          retryable: false,
          bodyText: await safeReadText(response)
        };
      }

      const errorBody = await tryReadErrorBody(response);
      if (errorBody?.quota) {
        return {
          ok: false,
          status: response.status,
          authFailure: false,
          quota: true,
          retryable: false,
          resetAtMs: errorBody.resetAtMs,
          bodyText: errorBody.rawText
        };
      }

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        return {
          ok: false,
          status: response.status,
          authFailure: false,
          quota: false,
          retryable,
          bodyText: errorBody?.rawText ?? (await safeReadText(response))
        };
      }

      return {
        ok: true,
        status: response.status,
        response,
        quota: false,
        authFailure: false
      };
    } catch (error) {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
      if (error instanceof Error && error.name === "AbortError") {
        if (externalSignal?.aborted) {
          return {
            ok: false,
            status: 499,
            authFailure: false,
            quota: false,
            aborted: true,
            retryable: false,
            bodyText: "client_aborted"
          };
        }
        return {
          ok: false,
          status: 504,
          authFailure: false,
          quota: false,
          retryable: true,
          bodyText: "gateway_timeout"
        };
      }
      return {
        ok: false,
        status: 502,
        authFailure: false,
        quota: false,
        retryable: true,
        bodyText: error instanceof Error ? error.message : "gateway_fetch_error"
      };
    }
  }

  private async fetchWithRetry(
    targetUrl: URL,
    method: string | undefined,
    headers: Headers,
    body: Buffer,
    externalSignal?: AbortSignal
  ): Promise<ForwardResult> {
    const maxRetries = normalizeRetryCount(this.config.upstreamMaxRetries);
    const baseDelayMs = Math.max(0, this.config.upstreamRetryBaseMs);
    const maxDelayMs = Math.max(baseDelayMs, this.config.upstreamRetryMaxMs);
    const jitterMs = Math.max(0, this.config.upstreamRetryJitterMs);
    const maxAttempts = maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (externalSignal?.aborted) {
        return {
          ok: false,
          status: 499,
          authFailure: false,
          quota: false,
          aborted: true,
          retryable: false,
          bodyText: "client_aborted"
        };
      }

      const result = await this.fetchOnce(targetUrl, method, headers, body, externalSignal);

      if (result.ok || result.quota || result.authFailure || result.aborted) {
        return result;
      }

      if (!result.retryable || attempt >= maxAttempts - 1) {
        return result;
      }

      const delayMs = computeRetryDelay(attempt, baseDelayMs, maxDelayMs, jitterMs);
      const shouldContinue = await sleepWithAbort(delayMs, externalSignal);
      if (!shouldContinue) {
        return {
          ok: false,
          status: 499,
          authFailure: false,
          quota: false,
          aborted: true,
          retryable: false,
          bodyText: "client_aborted"
        };
      }
    }

    return {
      ok: false,
      status: 502,
      authFailure: false,
      quota: false,
      retryable: false,
      bodyText: "gateway_retry_exhausted"
    };
  }

  private async ensureAccessToken(account: AccountState): Promise<string | undefined> {
    if (this.pool.isTokenFresh(account, TOKEN_REFRESH_BUFFER_SECONDS)) {
      return account.tokens.accessToken;
    }

    const existing = this.inFlightRefresh.get(account.name);
    if (existing) {
      const updated = await existing;
      return updated.accessToken;
    }

    const refreshPromise = this.refreshToken(account);
    this.inFlightRefresh.set(account.name, refreshPromise);

    try {
      const refreshed = await refreshPromise;
      return refreshed.accessToken;
    } finally {
      this.inFlightRefresh.delete(account.name);
    }
  }

  private async refreshToken(account: AccountState): Promise<TokenPair> {
    const response = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.tokens.refreshToken,
        client_id: this.config.oauthClientId
      })
    });

    if (!response.ok) {
      const errorText = await safeReadText(response);
      throw new Error(`token_refresh_failed: ${errorText}`);
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      id_token?: string;
      account_id?: string;
    };

    const details = deriveTokenDetails(payload.access_token, payload.id_token);

    const updated: TokenPair = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken: payload.id_token,
      accountId: payload.account_id ?? details.chatgptAccountId,
      ...details
    };

    this.pool.updateTokens(account, updated);

    return updated;
  }
}

interface ForwardResult {
  ok: boolean;
  status: number;
  response?: Response;
  quota: boolean;
  resetAtMs?: number;
  authFailure: boolean;
  aborted?: boolean;
  retryable?: boolean;
  bodyText?: string;
}

function resolveSessionKey(req: IncomingMessage): string {
  const headerKeys = ["x-session-id", "openai-session", "x-openai-session", "x-request-id"];

  for (const key of headerKeys) {
    const value = req.headers[key] as string | undefined;
    if (value) {
      return `${key}:${value}`;
    }
  }

  return req.socket.remoteAddress ? `ip:${req.socket.remoteAddress}` : "default";
}

function buildForwardHeaders(
  req: IncomingMessage,
  account: AccountState,
  accessToken: string | undefined,
  config: GatewayConfig
): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) {
      continue;
    }

    const lowerKey = key.toLowerCase();

    if (lowerKey === "host") {
      continue;
    }

    if (lowerKey === "content-length") {
      continue;
    }

    if (config.overrideAuth && lowerKey === "authorization") {
      continue;
    }

    if (config.overrideAuth && lowerKey === "cookie") {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else {
      headers.set(key, value);
    }
  }

  if (config.overrideAuth && accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  if (config.overrideAuth) {
    applyAccountHeaders(headers, account);
  }

  return headers;
}

function applyAccountHeaders(headers: Headers, account: AccountState): void {
  const sessionId = account.tokens.sessionId;
  if (sessionId) {
    headers.set("openai-session", sessionId);
    headers.set("x-openai-session", sessionId);
  }

  const accountId = account.tokens.chatgptAccountId ?? account.tokens.accountId;
  if (accountId) {
    headers.set("openai-account-id", accountId);
    headers.set("x-openai-account-id", accountId);
  }

  const userId = account.tokens.userId ?? account.tokens.chatgptUserId;
  if (userId) {
    headers.set("openai-user-id", userId);
    headers.set("x-openai-user-id", userId);
  }

  const organizationId = account.tokens.organizationId;
  if (organizationId) {
    headers.set("openai-organization", organizationId);
    headers.set("openai-organization-id", organizationId);
  }
}

function logRequestDebug(req: IncomingMessage, body: Buffer): void {
  if (process.env.CAO_DEBUG_HEADERS !== "1") {
    return;
  }

  const headerLines: string[] = [];

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) {
      continue;
    }

    if (!shouldLogHeader(key)) {
      continue;
    }

    const rawValue = Array.isArray(value) ? value.join(",") : value;
    headerLines.push(`${key}: ${redactHeaderValue(key, rawValue)}`);
  }

  if (headerLines.length > 0) {
    process.stdout.write(`Gateway debug headers:\n${headerLines.join("\n")}\n`);
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const sessionId = parseJwtSessionId(token);
    if (sessionId) {
      process.stdout.write(`Gateway debug incoming session_id: ${sessionId}\n`);
    }
  }

  if (process.env.CAO_DEBUG_BODY === "1") {
    const snippet = formatBodySnippet(body);
    process.stdout.write(`Gateway debug body (${body.length} bytes): ${snippet}\n`);
  } else {
    process.stdout.write(`Gateway debug body length: ${body.length} bytes\n`);
  }

  if (process.env.CAO_CAPTURE_BODY === "1") {
    const capturePath = process.env.CAO_CAPTURE_BODY_PATH ?? "/tmp/cao-last-body.json";
    try {
      fs.writeFileSync(capturePath, body);
      process.stdout.write(`Gateway debug body saved: ${capturePath}\n`);
    } catch (error) {
      process.stdout.write(
        `Gateway debug body save failed: ${error instanceof Error ? error.message : "unknown"}\n`
      );
    }
  }
}

function logUpstreamDebug(method: string, url: URL, headers: Headers): void {
  if (process.env.CAO_DEBUG_HEADERS !== "1") {
    return;
  }

  const headerLines: string[] = [];
  headers.forEach((value, key) => {
    if (!shouldLogHeader(key)) {
      return;
    }
    headerLines.push(`${key}: ${redactHeaderValue(key, value)}`);
  });

  process.stdout.write(`Gateway debug upstream ${method} ${url.toString()}\n`);
  if (headerLines.length > 0) {
    process.stdout.write(`${headerLines.join("\n")}\n`);
  }
}

function shouldLogHeader(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("openai") ||
    lower.includes("authorization") ||
    lower.includes("session") ||
    lower === "user-agent" ||
    lower === "content-type"
  );
}

function redactHeaderValue(key: string, value: string): string {
  const lower = key.toLowerCase();

  if (lower.includes("authorization") || lower.includes("token")) {
    return redactValue(value);
  }

  if (lower.includes("cookie")) {
    return "<redacted>";
  }

  if (lower.includes("session")) {
    return redactValue(value);
  }

  return value;
}

function redactValue(value: string): string {
  if (value.length <= 12) {
    return "<redacted>";
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatBodySnippet(body: Buffer): string {
  const text = body.toString("utf8");
  const sanitized = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  return truncate(sanitized, 400);
}

function shouldForceQuota(accountName: string): boolean {
  const forced = process.env.CAO_FORCE_QUOTA_ACCOUNTS;
  if (!forced) {
    return false;
  }

  return forced
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .includes(accountName);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (error) {
    if (req.aborted) {
      return Buffer.alloc(0);
    }
    throw error;
  }

  return Buffer.concat(chunks);
}

async function streamResponse(res: ServerResponse, upstream: Response): Promise<void> {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    headers[key] = value;
  });

  if (res.headersSent || res.writableEnded || res.destroyed) {
    return;
  }

  res.writeHead(upstream.status, headers);

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();

  while (true) {
    if (res.destroyed || res.writableEnded) {
      await reader.cancel();
      break;
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      if (res.destroyed || res.writableEnded) {
        await reader.cancel();
        break;
      }
      res.write(Buffer.from(value));
    }
  }

  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function writeErrorResponse(res: ServerResponse, status: number, bodyText?: string): Promise<void> {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(bodyText ?? "{}");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function buildTargetUrl(baseUrl: string, requestPath: string): URL {
  const base = new URL(baseUrl);
  const requestUrl = new URL(requestPath, "http://localhost");
  const basePath = base.pathname.endsWith("/") ? base.pathname.slice(0, -1) : base.pathname;
  const requestPathname = requestUrl.pathname.startsWith("/")
    ? requestUrl.pathname
    : `/${requestUrl.pathname}`;

  base.pathname = `${basePath}${requestPathname}`;
  base.search = requestUrl.search;

  if (baseUrl.includes("chatgpt.com/backend-api/codex")) {
    if (base.pathname.startsWith("/backend-api/codex/v1/responses")) {
      base.pathname = "/backend-api/codex/responses/compact";
      base.search = "";
    }
  }

  return base;
}

async function tryReadErrorBody(
  response: Response
): Promise<{ quota: boolean; resetAtMs?: number; rawText: string } | undefined> {
  if (response.ok) {
    return undefined;
  }

  const rawText = await safeReadText(response);

  try {
    const parsed = JSON.parse(rawText) as {
      error?: { type?: string; resets_at?: number; resets_in_seconds?: number };
    };

    if (parsed.error?.type === "usage_limit_reached") {
      const resetAtMs = parsed.error.resets_at ? parsed.error.resets_at * 1000 : undefined;
      return { quota: true, resetAtMs, rawText };
    }

    if (response.status === 429) {
      const resetAtMs = parsed.error?.resets_at ? parsed.error.resets_at * 1000 : undefined;
      return { quota: true, resetAtMs, rawText };
    }
  } catch {
    if (response.status === 429) {
      return { quota: true, rawText };
    }
  }

  return { quota: false, rawText };
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function normalizeRetryCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number
): number {
  if (baseDelayMs <= 0) {
    return 0;
  }

  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return Math.min(maxDelayMs, exponential + jitter);
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(true);
  }

  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup(true);
    }, ms);

    const onAbort = () => cleanup(false);

    const cleanup = (result: boolean) => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
