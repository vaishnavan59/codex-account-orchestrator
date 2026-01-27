import fs from "fs";
import path from "path";

export interface GatewayConfig {
  bindAddress: string;
  port: number;
  baseUrl: string;
  oauthClientId: string;
  cooldownSeconds: number;
  maxRetryPasses: number;
  requestTimeoutMs: number;
  overrideAuth: boolean;
}

const DEFAULT_CONFIG: GatewayConfig = {
  bindAddress: "127.0.0.1",
  port: 4319,
  baseUrl: "https://chatgpt.com/backend-api/codex",
  oauthClientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  cooldownSeconds: 900,
  maxRetryPasses: 1,
  requestTimeoutMs: 120_000,
  overrideAuth: true
};

export function resolveGatewayConfig(overrides: Partial<GatewayConfig>): GatewayConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides
  };
}

export function getGatewayConfigPath(): string {
  return path.join(process.env.HOME ?? "", ".codex-account-orchestrator", "gateway.json");
}

export function loadGatewayConfig(): Partial<GatewayConfig> {
  const configPath = getGatewayConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as Partial<GatewayConfig>;
}

export function saveGatewayConfig(config: Partial<GatewayConfig>): void {
  const configPath = getGatewayConfigPath();
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
