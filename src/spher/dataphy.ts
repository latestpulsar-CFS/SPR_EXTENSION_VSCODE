import { spawn } from "node:child_process";
import { DataphyEnvelope } from "./types";

export interface DataphyExecConfig {
  enabled: boolean;
  strictMode: boolean;
  dataphyCliPath: string;
  dataphyTimeoutMs: number;
  dataphyUseCargoFallback: boolean;
  dataphyManifestPath: string;
  dataphyCwd: string;
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function bytesToHex(bytes: number[]): string {
  return bytes
    .map((b) => Math.max(0, Math.min(255, b)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeHashField(v: unknown): string {
  if (typeof v === "string") {
    return v.toLowerCase();
  }
  if (Array.isArray(v)) {
    const nums = v.map((x) => Number(x));
    if (nums.every((n) => Number.isFinite(n))) {
      return bytesToHex(nums);
    }
  }
  return "";
}

function normalizeEnvelope(raw: unknown): DataphyEnvelope | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const directAnchor = normalizeHashField(obj.anchor_sha256);
  const directConfig = normalizeHashField(obj.config_hash);
  const directFeatures = Array.isArray(obj.features_fixed)
    ? obj.features_fixed.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];

  if (directAnchor && directConfig && directFeatures.length > 0) {
    return {
      anchor_sha256: directAnchor,
      config_hash: directConfig,
      features_fixed: directFeatures
    };
  }

  const freeze = (obj.freeze ?? {}) as Record<string, unknown>;
  const nestedAnchor = normalizeHashField(freeze.anchor_sha256);
  const nestedConfig = normalizeHashField(freeze.config_hash);
  if (nestedAnchor && nestedConfig && directFeatures.length > 0) {
    return {
      anchor_sha256: nestedAnchor,
      config_hash: nestedConfig,
      features_fixed: directFeatures
    };
  }

  return undefined;
}

function parseJsonFromStdout(stdout: string): unknown {
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

function runProcess(exe: string, args: string[], stdinText: string, cwd?: string, timeoutMs = 8000): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const done = (result: ProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      done({ code: -2, stdout, stderr: `${stderr}\nTimeout after ${timeoutMs}ms` });
    }, Math.max(1000, timeoutMs));

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });

    if (stdinText.length > 0) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

export async function computeDataphyEnvelope(input: string, cfg: DataphyExecConfig): Promise<DataphyEnvelope | undefined> {
  if (!cfg.enabled) {
    return undefined;
  }

  const cwd = cfg.dataphyCwd.trim() || undefined;
  const cliPath = cfg.dataphyCliPath.trim();
  const timeoutMs = cfg.dataphyTimeoutMs;
  const payload = input;

  const attempts: Array<{ exe: string; args: string[] }> = [];
  if (cliPath) {
    attempts.push({ exe: cliPath, args: [] });
  }
  if (cfg.dataphyUseCargoFallback && cfg.dataphyManifestPath.trim()) {
    attempts.push({
      exe: "cargo",
      args: ["run", "--manifest-path", cfg.dataphyManifestPath.trim(), "--bin", "dataphy_cli", "--"]
    });
  }

  if (attempts.length === 0) {
    throw new Error("DATAPHY enabled but no CLI path/fallback configured.");
  }

  let lastErr = "";
  for (const attempt of attempts) {
    const run = await runProcess(attempt.exe, attempt.args, payload, cwd, timeoutMs);
    if (run.code === 0) {
      const parsed = parseJsonFromStdout(run.stdout);
      const envelope = normalizeEnvelope(parsed);
      if (envelope) {
        return envelope;
      }
      lastErr = `DATAPHY output is not a valid envelope.`;
      continue;
    }
    lastErr = `${attempt.exe} exited with code=${run.code} stderr=${run.stderr.trim()}`;
  }

  throw new Error(lastErr || "Unable to compute DATAPHY envelope.");
}

