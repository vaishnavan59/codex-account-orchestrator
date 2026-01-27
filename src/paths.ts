import os from "os";
import path from "path";

import { ACCOUNT_STATUS_FILE_NAME, REGISTRY_FILE_NAME } from "./constants";

export function getBaseDir(dataDir?: string): string {
  if (dataDir && dataDir.trim().length > 0) {
    return path.resolve(dataDir);
  }

  return path.join(os.homedir(), ".codex-account-orchestrator");
}

export function getAccountDir(baseDir: string, accountName: string): string {
  return path.join(baseDir, accountName);
}

export function getRegistryPath(baseDir: string): string {
  return path.join(baseDir, REGISTRY_FILE_NAME);
}

export function getAccountStatusPath(baseDir: string): string {
  return path.join(baseDir, ACCOUNT_STATUS_FILE_NAME);
}
