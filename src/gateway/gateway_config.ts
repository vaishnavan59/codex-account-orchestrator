import fs from "fs";
import os from "os";
import path from "path";

export interface GatewayConfig {
  bindAddress: string;
  port: number;
  baseUrl: string;
  oauthClientId: string;
  cooldownSeconds: number;
  maxRetryPasses: number;
  requestTimeoutMs: number;
  upstreamMaxRetries: number;
  upstreamRetryBaseMs: number;
  upstreamRetryMaxMs: number;
  upstreamRetryJitterMs: number;
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
  upstreamMaxRetries: 2,
  upstreamRetryBaseMs: 200,
  upstreamRetryMaxMs: 2_000,
  upstreamRetryJitterMs: 120,
  overrideAuth: true
};

export function resolveGatewayConfig(overrides: Partial<GatewayConfig>): GatewayConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides
  };
}

export function getGatewayConfigPath(): string {
  return path.join(os.homedir(), ".codex-account-orchestrator", "gateway.json");
}

export function loadGatewayConfig(): Partial<GatewayConfig> {
  const configPath = getGatewayConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw) as Partial<GatewayConfig>;
  } catch (error) {
    const backupPath = `${configPath}.corrupt-${Date.now()}`;
    fs.writeFileSync(backupPath, raw, "utf8");
    process.stderr.write(
      `Warning: gateway.json was invalid and has been backed up to ${backupPath}.\n`
    );
    return {};
  }
}

export function saveGatewayConfig(config: Partial<GatewayConfig>): void {
  const configPath = getGatewayConfigPath();
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
