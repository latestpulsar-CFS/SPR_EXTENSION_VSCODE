import { ComputeEvent, EventsResponse, SpherState } from "./types";

export interface SpherClientConfig {
  baseUrl: string;
  apiUser: string;
  token?: string;
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
      model_version: "0.2.2",
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






