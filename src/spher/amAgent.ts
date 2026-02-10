import { spawn } from "node:child_process";
import { PrimusCredentials } from "../auth/primus";

export interface AmAgentConfig {
  amAgentPath: string;
  allowCargoFallback: boolean;
  orchestratorManifestPath: string;
}

export interface AmAgentExecution {
  ok: boolean;
  command: string;
  parsed?: unknown;
  stdout: string;
  stderr: string;
  code: number;
}

function runProcess(exe: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      stderr += err.message;
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function parseJsonFromStdout(stdout: string): unknown {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // continue
    }
  }
  return undefined;
}

async function executeMessage(config: AmAgentConfig, message: string): Promise<AmAgentExecution> {
  const direct = await runProcess(config.amAgentPath, [message]);
  if (direct.code === 0) {
    return {
      ok: true,
      command: message,
      parsed: parseJsonFromStdout(direct.stdout),
      stdout: direct.stdout,
      stderr: direct.stderr,
      code: direct.code
    };
  }

  if (config.allowCargoFallback && config.orchestratorManifestPath.trim()) {
    const cargo = await runProcess(
      "cargo",
      ["run", "--manifest-path", config.orchestratorManifestPath, "--bin", "am-agent", "--", message]
    );
    return {
      ok: cargo.code === 0,
      command: message,
      parsed: parseJsonFromStdout(cargo.stdout),
      stdout: cargo.stdout,
      stderr: cargo.stderr,
      code: cargo.code
    };
  }

  return {
    ok: false,
    command: message,
    parsed: parseJsonFromStdout(direct.stdout),
    stdout: direct.stdout,
    stderr: direct.stderr,
    code: direct.code
  };
}

export async function executeControlMessage(config: AmAgentConfig, message: string): Promise<AmAgentExecution> {
  return executeMessage(config, message);
}

export async function executePriorityMutation(
  config: AmAgentConfig,
  action: string,
  creds: PrimusCredentials
): Promise<{ request: AmAgentExecution; auth: AmAgentExecution }> {
  const request = await executeMessage(config, `AM::PRIORITY::REQUEST ${action}`);
  const auth = await executeMessage(
    config,
    `AM::PRIORITY::AUTH ${creds.user} ${creds.password} ${creds.phrase}`
  );
  return { request, auth };
}
