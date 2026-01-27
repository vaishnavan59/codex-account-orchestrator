export const REGISTRY_FILE_NAME = "registry.json";
export const AUTH_FILE_NAME = "auth.json";
export const ACCOUNT_STATUS_FILE_NAME = "account_status.json";

export const DEFAULT_CONFIG_TOML = [
  "# Codex config for this account",
  "cli_auth_credentials_store = \"file\"",
  "forced_login_method = \"chatgpt\"",
  ""
].join("\n");

export const QUOTA_ERROR_PATTERNS: RegExp[] = [
  /usage\s*limit/i,
  /quota/i,
  /exceeded/i,
  /insufficient\s+credits/i,
  /insufficient\s+quota/i,
  /credits?\s+exhausted/i
];

export const MAX_CAPTURED_LINES = 200;
