import * as vscode from "vscode";
import { registerCommands } from "./commands/register";
import { AuditStore } from "./audit/store";
import { executeControlMessage } from "./spher/amAgent";
import { SpherClient } from "./spher/client";
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let tokenCache = await context.secrets.get(TOKEN_KEY);
  let lastAwakeAttemptMs = 0;
  let awakeInFlight = false;
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

  const client = new SpherClient(getConfig);
  const audit = new AuditStore(context);
  const panel = new SpherPanel(context);

  registerCommands(context, {
    client,
    panel,
    audit,
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
    amAgentConfig: () => {
      const cfg = vscode.workspace.getConfiguration("spher");
      return {
        amAgentPath: cfg.get<string>("amAgentPath", "am-agent"),
        allowCargoFallback: cfg.get<boolean>("allowCargoFallback", true),
        orchestratorManifestPath: cfg.get<string>(
          "orchestratorManifestPath",
          "C:/Users/DNA/Desktop/spher43/crates/am_orchestrator/Cargo.toml"
        )
      };
    }
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

  const pollMs = vscode.workspace.getConfiguration("spher").get<number>("pollMs", 1200);
  const pollOnce = async () => {
    try {
      const [state, latest, events] = await Promise.all([
        client.getState(),
        client.getLatest(),
        client.getEvents(1, 200)
      ]);
      const recent = [...(events.items || [])].sort(eventOrder).slice(0, 40);
      panel.updateState(state);
      panel.updateEvents(recent);
      const mode = state.strict_mutation_proof ? "strict" : "soft";
      status.text = `$(shield) SPHER: connected (${mode})`;
      status.tooltip = `llm_read_only=${String(state.llm_read_only)} strict_mutation_proof=${String(state.strict_mutation_proof)}`;
      const latestMs = eventTimeMs(latest);
      const ageMin = latestMs > 0 ? Math.floor((Date.now() - latestMs) / 60000) : -1;
      const freshness = ageMin >= 0 ? `latest_event_age_min=${ageMin}` : "latest_event_age_min=unknown";
      panel.info(`Connected to ${getConfig().baseUrl} (${freshness})`);
      output.appendLine(`poll: connected ${getConfig().baseUrl} events=${recent.length} ${freshness}`);

      const cfg = vscode.workspace.getConfiguration("spher");
      const autoAwake = cfg.get<boolean>("autoAwake", true);
      const isAwake = state.spher_mode === true;
      if (autoAwake && !isAwake && !awakeInFlight && Date.now() - lastAwakeAttemptMs > 15000) {
        awakeInFlight = true;
        lastAwakeAttemptMs = Date.now();
        panel.info("SPHER mode is false. Attempting SPHER::AWAKE via am-agent...");
        output.appendLine("poll: attempting SPHER::AWAKE");
        try {
          const awake = await executeControlMessage(
            {
              amAgentPath: cfg.get<string>("amAgentPath", "am-agent"),
              allowCargoFallback: cfg.get<boolean>("allowCargoFallback", true),
              orchestratorManifestPath: cfg.get<string>(
                "orchestratorManifestPath",
                "C:/Users/DNA/Desktop/spher43/crates/am_orchestrator/Cargo.toml"
              )
            },
            "SPHER::AWAKE"
          );
          output.appendLine(`poll: SPHER::AWAKE ok=${awake.ok} code=${awake.code}`);
          if (awake.ok) {
            const refreshed = await client.getState();
            panel.updateState(refreshed);
            panel.info(`Auto-awake result: spher_mode=${String(refreshed.spher_mode)}`);
          } else {
            panel.info("Auto-awake failed. Check Output -> SPHER Governor.");
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

  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {
  // noop
}
