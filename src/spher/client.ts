import { ComputeEvent, EventsResponse, SpherState } from "./types";

export interface SpherClientConfig {
  baseUrl: string;
  apiUser: string;
  token?: string;
}

export interface ComputeStreamPayload {
  status?: string;
  line_idx?: number;
  count?: number;
  items?: ComputeEvent[];
  [k: string]: unknown;
}

function withAuthHeaders(config: SpherClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-user": config.apiUser
  };
  if (config.token && config.token.trim()) {
    headers.Authorization = `Bearer ${config.token.trim()}`;
  }
  return headers;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SpherClient {
  private readonly config: () => SpherClientConfig;

  constructor(config: () => SpherClientConfig) {
    this.config = config;
  }

  async getState(): Promise<SpherState> {
    return this.getJson<SpherState>("/am/state");
  }

  async runReadOnlyAction(action: string): Promise<unknown> {
    const req = {
      model_id: "spher-governor-vscode",
      model_version: "0.2.8",
      input: {
        task: "read_only_governed_action",
        action,
        intent: "read_only"
      },
      policy: {
        snc: { drift_max: 0.2, fail_closed: true },
        budgets: { max_ms: 30000, max_io_bytes: 5000000, max_mem_bytes: 536870912 }
      },
      trace: { run_id: "00000000-0000-0000-0000-000000000000", parent_proof: null, idmap: [] },
      constraints: { apply: false, source: "vscode_extension" }
    };
    return this.postJson("/am/run", req);
  }

  async getLatest(): Promise<ComputeEvent> {
    return this.getJson<ComputeEvent>("/api/v1/compute/latest");
  }

  async getEvents(page = 1, perPage = 50): Promise<EventsResponse> {
    return this.getJson<EventsResponse>(`/api/v1/compute/events?page=${page}&per_page=${perPage}`);
  }

  async streamEvents(
    onPayload: (payload: ComputeStreamPayload) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const cfg = this.config();
    const headers = withAuthHeaders(cfg);
    delete headers["Content-Type"];
    const token = cfg.token?.trim();
    const qs = new URLSearchParams();
    if (token) {
      qs.set("token", token);
    }
    if (cfg.apiUser?.trim()) {
      qs.set("api_user", cfg.apiUser.trim());
    }
    const url = `${cfg.baseUrl}/api/v1/compute/stream${qs.toString() ? `?${qs.toString()}` : ""}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        ...headers,
        Accept: "text/event-stream"
      },
      signal
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} on /api/v1/compute/stream`);
    }
    if (!resp.body) {
      throw new Error("No stream body from /api/v1/compute/stream");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const nextEventChunk = (): { chunk: string; rest: string } | undefined => {
      const separators = ["\r\n\r\n", "\n\n"];
      let bestIndex = -1;
      let bestSep = "";
      for (const sep of separators) {
        const idx = buffer.indexOf(sep);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
          bestIndex = idx;
          bestSep = sep;
        }
      }
      if (bestIndex === -1) {
        return undefined;
      }
      return {
        chunk: buffer.slice(0, bestIndex),
        rest: buffer.slice(bestIndex + bestSep.length)
      };
    };

    while (true) {
      if (signal?.aborted) {
        return;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let extracted = nextEventChunk();
      while (extracted) {
        const rawEvent = extracted.chunk;
        buffer = extracted.rest;
        const dataLines: string[] = [];
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length > 0) {
          const joined = dataLines.join("\n");
          try {
            onPayload(JSON.parse(joined) as ComputeStreamPayload);
          } catch {
            // keep stream alive even on occasional malformed frame
          }
        }
        extracted = nextEventChunk();
      }
    }
  }

  async sendControl(command: string): Promise<unknown> {
    const paths = ["/am/control", "/am/command", "/api/v1/am/command"];
    const errors: string[] = [];
    for (const path of paths) {
      for (const body of [{ command }, { message: command }]) {
        try {
          return await this.postJson(path, body);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${path} -> ${msg}`);
        }
      }
    }
    throw new Error(`No control endpoint accepted ${command}. ${errors.join(" | ")}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const cfg = this.config();
    const resp = await fetchWithTimeout(`${cfg.baseUrl}${path}`, {
      method: "GET",
      headers: withAuthHeaders(cfg)
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} on ${path}`);
    }
    return (await resp.json()) as T;
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const cfg = this.config();
    const resp = await fetchWithTimeout(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: withAuthHeaders(cfg),
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status} on ${path}: ${text}`);
    }
    return await resp.json();
  }
}









