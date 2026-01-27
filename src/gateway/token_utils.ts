export interface TokenDetails {
  expiresAtMs?: number;
  sessionId?: string;
  chatgptAccountId?: string;
  chatgptUserId?: string;
  userId?: string;
  organizationId?: string;
}

export interface TokenPair extends TokenDetails {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
}

interface JwtPayload {
  exp?: number;
  session_id?: string;
  sid?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_user_id?: string;
    user_id?: string;
    organizations?: Array<{ id?: string; is_default?: boolean }>;
  };
}

export function parseJwtExpiry(token: string): number | undefined {
  const payload = parseJwtPayload(token);

  if (!payload || typeof payload.exp !== "number") {
    return undefined;
  }

  return payload.exp * 1000;
}

export function parseJwtSessionId(token: string): string | undefined {
  const payload = parseJwtPayload(token);

  if (!payload) {
    return undefined;
  }

  if (typeof payload.session_id === "string") {
    return payload.session_id;
  }

  if (typeof payload.sid === "string") {
    return payload.sid;
  }

  return undefined;
}

export function deriveTokenDetails(accessToken: string, idToken?: string): TokenDetails {
  const payload = parseJwtPayload(accessToken);
  const details: TokenDetails = {
    expiresAtMs: parseJwtExpiry(accessToken),
    sessionId: parseJwtSessionId(accessToken)
  };

  const authPayload = payload?.["https://api.openai.com/auth"];
  if (authPayload) {
    details.chatgptAccountId = authPayload.chatgpt_account_id;
    details.chatgptUserId = authPayload.chatgpt_user_id;
    details.userId = authPayload.user_id;
  }

  const organizationId = parseOrganizationId(idToken ?? accessToken);
  if (organizationId) {
    details.organizationId = organizationId;
  }

  return details;
}

function parseJwtPayload(token: string): JwtPayload | undefined {
  const parts = token.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return undefined;
  }
}

function parseOrganizationId(token: string): string | undefined {
  const payload = parseJwtPayload(token);
  const authPayload = payload?.["https://api.openai.com/auth"];
  const organizations = authPayload?.organizations;

  if (!Array.isArray(organizations) || organizations.length === 0) {
    return undefined;
  }

  const defaultOrg = organizations.find((org) => org.is_default);
  return defaultOrg?.id ?? organizations[0]?.id;
}

export function isTokenFresh(expiresAtMs: number | undefined, bufferSeconds: number): boolean {
  if (!expiresAtMs) {
    return true;
  }

  const now = Date.now();
  return expiresAtMs - now > bufferSeconds * 1000;
}
