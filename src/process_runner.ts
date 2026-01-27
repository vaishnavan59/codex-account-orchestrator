import { spawn } from "child_process";

import { OutputCapture } from "./output_capture";
import { isQuotaError } from "./quota_detector";

export interface RunResult {
  exitCode: number;
  quotaError: boolean;
}

export async function runCodexOnce(
  codexBin: string,
  codexArgs: string[],
  accountDir: string,
  captureOutput: boolean,
  envOverrides: Record<string, string | undefined> = {}
): Promise<RunResult> {
  const capture = new OutputCapture();
  const env = {
    ...process.env,
    CODEX_HOME: accountDir,
    ...envOverrides
  };

  const child = spawn(codexBin, codexArgs, {
    env,
    stdio: captureOutput ? ["inherit", "pipe", "pipe"] : ["inherit", "inherit", "inherit"]
  });

  if (captureOutput && child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      capture.addChunk(chunk);
    });
  }

  if (captureOutput && child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      capture.addChunk(chunk);
    });
  }

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 1);
    });

    child.on("error", (error) => {
      process.stderr.write(`Failed to start codex: ${error.message}\n`);
      resolve(1);
    });
  });

  const outputText = captureOutput ? capture.getText() : "";

  return {
    exitCode,
    quotaError: captureOutput ? isQuotaError(outputText) : false
  };
}
