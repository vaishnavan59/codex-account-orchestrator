import fs from "fs";
import os from "os";
import path from "path";

const BACKUP_SUFFIX = ".cao.bak";

export interface CodexConfigUpdate {
  baseUrl: string;
}

export function enableGatewayConfig(update: CodexConfigUpdate): void {
  const configPath = getCodexConfigPath();
  const original = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  ensureBackup(configPath, original);

  let updated = original;

  if (/^model_provider\s*=.*$/m.test(updated)) {
    updated = updated.replace(/^model_provider\s*=.*$/m, 'model_provider = "openai"');
  } else {
    updated = `model_provider = "openai"\n${updated}`;
  }

  updated = upsertOpenAiBaseUrl(updated, update.baseUrl);

  fs.writeFileSync(configPath, `${updated.trimEnd()}\n`, "utf8");
}

export function disableGatewayConfig(): void {
  const configPath = getCodexConfigPath();
  const backupPath = `${configPath}${BACKUP_SUFFIX}`;

  if (!fs.existsSync(backupPath)) {
    return;
  }

  const backup = fs.readFileSync(backupPath, "utf8");
  fs.writeFileSync(configPath, backup, "utf8");
  fs.rmSync(backupPath, { force: true });
}

export function getCodexConfigPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function ensureBackup(configPath: string, content: string): void {
  const backupPath = `${configPath}${BACKUP_SUFFIX}`;

  if (fs.existsSync(backupPath)) {
    return;
  }

  fs.writeFileSync(backupPath, content, "utf8");
}

function buildProviderBlock(baseUrl: string): string {
  return [
    "[model_providers.openai]",
    "name = \"OpenAI\"",
    `base_url = \"${baseUrl}\"`,
    ""
  ].join("\n");
}

function upsertOpenAiBaseUrl(configText: string, baseUrl: string): string {
  const blockRegex = /\[model_providers\.openai\][\s\S]*?(?=\n\[|$)/;

  if (blockRegex.test(configText)) {
    const block = configText.match(blockRegex)?.[0] ?? "";
    let updatedBlock = block;

    if (/^base_url\s*=.*$/m.test(updatedBlock)) {
      updatedBlock = updatedBlock.replace(/^base_url\s*=.*$/m, `base_url = \"${baseUrl}\"`);
    } else {
      updatedBlock = `${updatedBlock.trimEnd()}\nbase_url = \"${baseUrl}\"\n`;
    }

    if (!/^name\s*=.*$/m.test(updatedBlock)) {
      updatedBlock = updatedBlock.replace(
        /\[model_providers\.openai\]\n?/,
        "[model_providers.openai]\nname = \"OpenAI\"\n"
      );
    }

    return configText.replace(blockRegex, updatedBlock.trimEnd());
  }

  const appendedBlock = buildProviderBlock(baseUrl);
  return `${configText.trimEnd()}\n\n${appendedBlock}`;
}
