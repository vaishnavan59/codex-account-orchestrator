import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

const SHIM_MARKER = "# CAO GATEWAY SHIM";
const REAL_CODEX_PATH_FILE = "real_codex_path";

export interface ShimResult {
  shimPath: string;
  realCodexPath: string;
  inPath: boolean;
}

export function enableGatewayShim(baseUrl: string): ShimResult {
  const realCodexPath = resolveCodexPath();
  const shimDir = resolveShimDir();
  const shimPath = path.join(shimDir, "codex");

  if (!fs.existsSync(shimDir)) {
    fs.mkdirSync(shimDir, { recursive: true });
  }

  const script = [
    "#!/usr/bin/env bash",
    SHIM_MARKER,
    `REAL_CODEX=\"${realCodexPath}\"`,
    `export OPENAI_BASE_URL=\"${baseUrl}\"`,
    "exec \"$REAL_CODEX\" \"$@\"",
    ""
  ].join("\n");

  fs.writeFileSync(shimPath, script, { encoding: "utf8", mode: 0o755 });

  const dataDir = path.join(os.homedir(), ".codex-account-orchestrator");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dataDir, REAL_CODEX_PATH_FILE), realCodexPath, "utf8");

  return {
    shimPath,
    realCodexPath,
    inPath: isDirInPath(shimDir)
  };
}

export function disableGatewayShim(): boolean {
  const shimDir = resolveShimDir();
  const shimPath = path.join(shimDir, "codex");

  if (!fs.existsSync(shimPath)) {
    return false;
  }

  const contents = fs.readFileSync(shimPath, "utf8");
  if (!contents.includes(SHIM_MARKER)) {
    return false;
  }

  fs.rmSync(shimPath, { force: true });
  return true;
}

function resolveCodexPath(): string {
  const shimPath = path.join(resolveShimDir(), "codex");
  const whichOutput = execSync("which -a codex", { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of whichOutput) {
    if (line.includes("aliased to")) {
      continue;
    }
    if (line === shimPath) {
      continue;
    }
    if (fs.existsSync(line)) {
      return line;
    }
  }

  const fallback = execSync("command -v codex", { encoding: "utf8" }).trim();
  if (!fallback || fallback === shimPath) {
    throw new Error(
      "codex binary not found in PATH (or only the CAO shim is present). Disable the shim first."
    );
  }

  return fallback;
}

function resolveShimDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

function isDirInPath(dir: string): boolean {
  const envPath = process.env.PATH ?? "";
  return envPath.split(":").includes(dir);
}
