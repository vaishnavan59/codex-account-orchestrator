import { spawn } from "child_process";

interface CodexCommandResult {
  exitCode: number;
}

function runCodexCommand(
  codexBin: string,
  args: string[],
  accountDir: string,
  stdio: "inherit" | "ignore"
): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, args, {
      env: { ...process.env, CODEX_HOME: accountDir },
      stdio
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1 });
    });

    child.on("error", (error) => {
      process.stderr.write(`Failed to start codex: ${error.message}\n`);
      resolve({ exitCode: 1 });
    });
  });
}

export async function isCodexLoggedIn(
  codexBin: string,
  accountDir: string
): Promise<boolean> {
  const result = await runCodexCommand(codexBin, ["login", "status"], accountDir, "ignore");
  return result.exitCode === 0;
}

export async function runCodexLogin(
  codexBin: string,
  accountDir: string,
  useDeviceAuth: boolean
): Promise<number> {
  const primaryArgs = useDeviceAuth ? ["login", "--device-auth"] : ["login"];
  const primaryResult = await runCodexCommand(codexBin, primaryArgs, accountDir, "inherit");

  if (primaryResult.exitCode === 0) {
    return 0;
  }

  if (useDeviceAuth) {
    return primaryResult.exitCode;
  }

  const fallbackResult = await runCodexCommand(codexBin, ["--login"], accountDir, "inherit");
  return fallbackResult.exitCode;
}
