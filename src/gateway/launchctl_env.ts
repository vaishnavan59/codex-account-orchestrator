import { execFileSync } from "child_process";

export interface LaunchctlEnvSnapshot {
  value?: string;
}

export interface LaunchctlEnvResult {
  previous: LaunchctlEnvSnapshot;
  applied: boolean;
  error?: string;
  restore: () => void;
}

function readLaunchctlEnv(name: string): string | undefined {
  try {
    const value = execFileSync("launchctl", ["getenv", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value.length > 0 ? value : "";
  } catch {
    return undefined;
  }
}

function setLaunchctlEnv(name: string, value: string): void {
  execFileSync("launchctl", ["setenv", name, value], {
    stdio: ["ignore", "ignore", "ignore"]
  });
}

function unsetLaunchctlEnv(name: string): void {
  execFileSync("launchctl", ["unsetenv", name], {
    stdio: ["ignore", "ignore", "ignore"]
  });
}

export function applyLaunchctlEnv(name: string, value: string): LaunchctlEnvResult {
  const previous: LaunchctlEnvSnapshot = { value: readLaunchctlEnv(name) };

  try {
    setLaunchctlEnv(name, value);
  } catch (error) {
    return {
      previous,
      applied: false,
      error: error instanceof Error ? error.message : "launchctl_setenv_failed",
      restore: () => {
        // no-op: setenv failed, so nothing to restore
      }
    };
  }

  const restore = (): void => {
    if (previous.value === undefined) {
      try {
        unsetLaunchctlEnv(name);
      } catch {
        // best-effort
      }
      return;
    }

    try {
      setLaunchctlEnv(name, previous.value);
    } catch {
      // best-effort
    }
  };

  return { previous, applied: true, restore };
}
