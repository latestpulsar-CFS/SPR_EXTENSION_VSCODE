import * as vscode from "vscode";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { registerCommands } from "./commands/register";
import { AuditStore } from "./audit/store";
import { executeControlMessage } from "./spher/amAgent";
import { ComputeStreamPayload, SpherClient } from "./spher/client";
import { ComputeEvent } from "./spher/types";
import { SpherPanel } from "./ui/panel";

const TOKEN_KEY = "spher.apiToken";

function eventTimeMs(e: ComputeEvent): number {
  if (!e?.ts) {
    return 0;
  }
  const parsed = Date.parse(e.ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function eventOrder(a: ComputeEvent, b: ComputeEvent): number {
  const aId = typeof a.event_id === "number" ? a.event_id : -1;
  const bId = typeof b.event_id === "number" ? b.event_id : -1;
  if (aId !== bId) {
    return bId - aId;
  }
  return eventTimeMs(b) - eventTimeMs(a);
}

function eventKey(e: ComputeEvent): string {
  if (typeof e.event_id === "number") {
    return `id:${e.event_id}`;
  }
  return `ts:${String(e.ts || "")}|action:${String(e.action || "")}|status:${String(e.status || "")}`;
}

function mergeRecentEvents(current: ComputeEvent[], incoming: ComputeEvent[]): ComputeEvent[] {
  const m = new Map<string, ComputeEvent>();
  for (const e of current) {
    m.set(eventKey(e), e);
  }
  for (const e of incoming) {
    m.set(eventKey(e), e);
  }
  return Array.from(m.values()).sort(eventOrder).slice(0, 40);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let tokenCache = await context.secrets.get(TOKEN_KEY);
  let lastAwakeAttemptMs = 0;
  let awakeInFlight = false;
  let controlEndpointUnsupported = false;
  let lastPollLogMs = 0;
  let lastAgeMin = -1;
  let recentEvents: ComputeEvent[] = [];
  const output = vscode.window.createOutputChannel("SPHER Governor");
  context.subscriptions.push(output);

  const getConfig = () => {
    const cfg = vscode.workspace.getConfiguration("spher");
    return {
      baseUrl: cfg.get<string>("baseUrl", "http://127.0.0.1:7072"),
      apiUser: cfg.get<string>("apiUser", "dev"),
      token: tokenCache
    };
  };

  const workspaceRoot = (): string => {
    const first = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!first || first.scheme !== "file") {
      return "";
    }
    return first.fsPath;
  };

  const workspacePathIfExists = (...segments: string[]): string => {
    const root = workspaceRoot();
    if (!root) {
      return "";
    }
    const candidate = path.join(root, ...segments);
    return existsSync(candidate) ? candidate : "";
  };

  const amAgentRuntimeConfig = () => {
    const cfg = vscode.workspace.getConfiguration("spher");
    return {
      amAgentPath: cfg.get<string>("amAgentPath", "am-agent"),
      allowCargoFallback: cfg.get<boolean>("allowCargoFallback", true),
      orchestratorManifestPath: cfg.get<string>(
        "orchestratorManifestPath",
        workspacePathIfExists("crates", "am_orchestrator", "Cargo.toml")
      ),
      amAgentCwd: cfg.get<string>("amAgentCwd", workspaceRoot())
    };
  };

  const dataphyRuntimeConfig = () => {
    const cfg = vscode.workspace.getConfiguration("spher");
    return {
      enabled: cfg.get<boolean>("dataphyEnabled", false),
      strictMode: cfg.get<boolean>("strictMode", true),
      dataphyCliPath: cfg.get<string>("dataphyCliPath", "dataphy_cli"),
      dataphyTimeoutMs: cfg.get<number>("dataphyTimeoutMs", 8000),
      dataphyUseCargoFallback: cfg.get<boolean>("dataphyUseCargoFallback", true),
      dataphyManifestPath: cfg.get<string>("dataphyManifestPath", workspacePathIfExists("Cargo.toml")),
      dataphyCwd: cfg.get<string>("dataphyCwd", workspaceRoot())
    };
  };

  const extensionVersion = String((context.extension.packageJSON as { version?: unknown })?.version ?? "0.0.0");
  const client = new SpherClient(getConfig, extensionVersion);
  const audit = new AuditStore(context);
  const panel = new SpherPanel(context);

  registerCommands(context, {
    client,
    panel,
    audit,
    baseUrl: () => getConfig().baseUrl,
    setToken: async (token: string) => {
      tokenCache = token;
      await context.secrets.store(TOKEN_KEY, token);
    },
    clearToken: async () => {
      tokenCache = undefined;
      await context.secrets.delete(TOKEN_KEY);
    },
    computeUiUrl: () => {
      const cfg = vscode.workspace.getConfiguration("spher");
      return cfg.get<string>("computeUiUrl", "http://127.0.0.1:7191/ui/compute");
    },
    amAgentConfig: amAgentRuntimeConfig,
    dataphyConfig: dataphyRuntimeConfig
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "spherControlView",
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          const disposable = panel.attachWebview(webviewView.webview);
          webviewView.onDidDispose(() => disposable.dispose());
          context.subscriptions.push(disposable);
        }
      }
    )
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.name = "SPHER Governor";
  status.command = "spher.connectLocal";
  status.text = "$(shield) SPHER: boot";
  status.show();
  context.subscriptions.push(status);
  panel.info(`Connecting to ${getConfig().baseUrl} ...`);
  output.appendLine(`activate: baseUrl=${getConfig().baseUrl}`);

  const cfg = vscode.workspace.getConfiguration("spher");
  const useStream = cfg.get<boolean>("useStream", true);
  let streamStop = false;
  let streamAbort: AbortController | undefined;

  const applyStreamPayload = (payload: ComputeStreamPayload) => {
    if (payload.status === "batch" && Array.isArray(payload.items) && payload.items.length > 0) {
      recentEvents = mergeRecentEvents(recentEvents, payload.items);
      panel.updateEvents(recentEvents);
      output.appendLine(`stream: batch count=${payload.items.length} total=${recentEvents.length}`);
    }
  };

  const startStreamLoop = () => {
    if (!useStream) {
      return;
    }
    void (async () => {
      while (!streamStop) {
        streamAbort = new AbortController();
        try {
          output.appendLine(`stream: connecting ${getConfig().baseUrl}/api/v1/compute/stream`);
          panel.info(`Connecting stream to ${getConfig().baseUrl} ...`);
          await client.streamEvents(applyStreamPayload, streamAbort.signal);
          if (!streamStop) {
            output.appendLine("stream: ended by server, retrying...");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!streamStop) {
            output.appendLine(`stream: disconnected err=${msg}`);
          }
        }
        if (!streamStop) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    })();
  };

  startStreamLoop();

  const pollMs = vscode.workspace.getConfiguration("spher").get<number>("pollMs", 1200);
  const pollOnce = async () => {
    try {
      const [state, latest, events] = await Promise.all([
        client.getState(),
        client.getLatest(),
        client.getEvents(1, 200)
      ]);
      const recent = [...(events.items || [])].sort(eventOrder).slice(0, 40);
      recentEvents = mergeRecentEvents(recentEvents, recent);
      panel.updateState(state);
      panel.updateEvents(recentEvents);
      const mode = state.strict_mutation_proof ? "strict" : "soft";
      status.text = `$(shield) SPHER: connected (${mode})`;
      status.tooltip = `llm_read_only=${String(state.llm_read_only)} strict_mutation_proof=${String(state.strict_mutation_proof)}`;
      const latestMs = eventTimeMs(latest);
      const ageMin = latestMs > 0 ? Math.floor((Date.now() - latestMs) / 60000) : -1;
      const freshness = ageMin >= 0 ? `latest_event_age_min=${ageMin}` : "latest_event_age_min=unknown";
      panel.info(`Connected to ${getConfig().baseUrl} (${freshness})`);
      const now = Date.now();
      if (ageMin !== lastAgeMin || now - lastPollLogMs > 30000) {
        output.appendLine(`poll: connected ${getConfig().baseUrl} events=${recentEvents.length} ${freshness}`);
        lastAgeMin = ageMin;
        lastPollLogMs = now;
      }

      const cfg = vscode.workspace.getConfiguration("spher");
      const autoAwake = cfg.get<boolean>("autoAwake", true);
      const isAwake = state.spher_mode === true;
      if (autoAwake && !isAwake && !awakeInFlight && Date.now() - lastAwakeAttemptMs > 120000) {
        awakeInFlight = true;
        lastAwakeAttemptMs = Date.now();
        panel.info("SPHER mode is false. Attempting SPHER::AWAKE via am-agent...");
        output.appendLine("poll: attempting SPHER::AWAKE");
        try {
          let awakened = false;
          if (!controlEndpointUnsupported) {
            try {
              await client.sendControl("SPHER::AWAKE");
              awakened = true;
              output.appendLine("poll: SPHER::AWAKE via HTTP control endpoint accepted");
            } catch (httpErr) {
              const httpMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
              output.appendLine(`poll: SPHER::AWAKE via HTTP control failed: ${httpMsg}`);
              if (httpMsg.includes("HTTP 404")) {
                controlEndpointUnsupported = true;
                output.appendLine("poll: disabling HTTP awake attempts (control endpoint missing).");
              }
            }
          }

          if (!awakened) {
            const awake = await executeControlMessage(amAgentRuntimeConfig(), "SPHER::AWAKE");
            output.appendLine(`poll: SPHER::AWAKE via am-agent ok=${awake.ok} code=${awake.code}`);
          }

          const refreshed = await client.getState();
          panel.updateState(refreshed);
          if (refreshed.spher_mode === true) {
            panel.info("Auto-awake result: spher_mode=true");
          } else {
            panel.info(
              "spher_mode is still false on am-orch. Add a server control endpoint (/am/control) or wake inside the running am-orch process."
            );
          }
        } catch (awakeErr) {
          const awakeMsg = awakeErr instanceof Error ? awakeErr.message : String(awakeErr);
          output.appendLine(`poll: SPHER::AWAKE error=${awakeMsg}`);
          panel.info(`Auto-awake error: ${awakeMsg}`);
        } finally {
          awakeInFlight = false;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      status.text = "$(warning) SPHER: disconnected";
      status.tooltip = "Unable to reach local AM orchestrator";
      panel.info(`Disconnected from ${getConfig().baseUrl}: ${msg}`);
      output.appendLine(`poll: disconnected ${getConfig().baseUrl} err=${msg}`);

      const cfg = vscode.workspace.getConfiguration("spher");
      const currentBase = cfg.get<string>("baseUrl", "http://127.0.0.1:7072");
      if (currentBase !== "http://127.0.0.1:7072") {
        try {
          const probe = new SpherClient(() => ({
            baseUrl: "http://127.0.0.1:7072",
            apiUser: cfg.get<string>("apiUser", "dev"),
            token: tokenCache
          }));
          await probe.getState();
          await cfg.update("baseUrl", "http://127.0.0.1:7072", vscode.ConfigurationTarget.Workspace);
          panel.info("Auto-fix: switched spher.baseUrl to http://127.0.0.1:7072");
          output.appendLine("poll: auto-fix applied -> 7072");
        } catch {
          // keep current config; diagnostics are already visible in panel/output
        }
      }
    }
  };

  await pollOnce();
  const timer = setInterval(() => {
    void pollOnce();
  }, Math.max(300, pollMs));

  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
      streamStop = true;
      streamAbort?.abort();
    }
  });
}

export function deactivate(): void {
  // noop
}

