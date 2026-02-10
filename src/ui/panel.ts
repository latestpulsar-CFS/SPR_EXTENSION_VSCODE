import * as vscode from "vscode";
import { ComputeEvent, SpherState } from "../spher/types";

export class SpherPanel {
  private readonly webviews = new Set<vscode.Webview>();
  private latestState?: SpherState;
  private latestEvents: ComputeEvent[] = [];
  private latestInfo = "";

  constructor(_context: vscode.ExtensionContext) {
    // Webview instances are attached explicitly by the view provider.
  }

  updateState(state: SpherState): void {
    this.latestState = state;
    this.broadcast({ type: "state", state });
  }

  updateEvents(events: ComputeEvent[]): void {
    this.latestEvents = events;
    this.broadcast({ type: "events", events });
  }

  info(message: string): void {
    this.latestInfo = message;
    this.broadcast({ type: "info", message });
  }

  attachWebview(webview: vscode.Webview): vscode.Disposable {
    webview.options = { enableScripts: true };
    webview.html = this.renderHtml(this.latestState, this.latestEvents, this.latestInfo);
    this.webviews.add(webview);

    if (this.latestState) {
      void webview.postMessage({ type: "state", state: this.latestState });
    }
    if (this.latestEvents.length > 0) {
      void webview.postMessage({ type: "events", events: this.latestEvents });
    }
    if (this.latestInfo) {
      void webview.postMessage({ type: "info", message: this.latestInfo });
    }

    return {
      dispose: () => {
        this.webviews.delete(webview);
      }
    };
  }

  private broadcast(message: unknown): void {
    for (const webview of this.webviews) {
      void webview.postMessage(message).then((ok) => {
        if (!ok) {
          // Fallback: force a full render if message channel is not ready.
          webview.html = this.renderHtml(this.latestState, this.latestEvents, this.latestInfo);
        }
      });
    }
  }

  private renderHtml(initialState?: SpherState, initialEvents: ComputeEvent[] = [], initialInfo = ""): string {
    const stateJson = JSON.stringify(initialState ?? {}).replace(/</g, "\\u003c");
    const eventsJson = JSON.stringify(initialEvents ?? []).replace(/</g, "\\u003c");
    const infoJson = JSON.stringify(initialInfo ?? "").replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
body { font-family: Segoe UI, sans-serif; color: #dbeafe; background: #0b1220; padding: 12px; }
.card { background: #111a2b; border: 1px solid #274060; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.bad { color: #fca5a5; }
.ok { color: #86efac; }
pre { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 8px; max-height: 360px; overflow: auto; }
.small { color: #93c5fd; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h3>SPHER State</h3>
    <div id="state">waiting...</div>
  </div>
  <div class="card">
    <h3>Compute Terminal</h3>
    <pre id="term">No events yet.</pre>
  </div>
  <div class="small" id="info"></div>
<script>
const stateEl = document.getElementById('state');
const termEl = document.getElementById('term');
const infoEl = document.getElementById('info');
const renderState = (s) => {
  stateEl.innerHTML = [
    'status: ' + String(s.status || '-'),
    'spher_mode: ' + String(s.spher_mode),
    'strict_mutation_proof: ' + String(s.strict_mutation_proof),
    'llm_read_only: ' + String(s.llm_read_only)
  ].join('<br/>');
};
const renderEvents = (events) => {
  const lines = (events || []).slice(-40).map((e) => {
    return '[' + (e.ts || '-') + '] ' +
      'action=' + (e.action || '-') + ' ' +
      'status=' + (e.status || '-') + ' ' +
      'gate=' + (e.gate_status || '-');
  });
  termEl.textContent = lines.length ? lines.join('\\n') : 'No events yet.';
  termEl.scrollTop = termEl.scrollHeight;
};
const initialState = ${stateJson};
const initialEvents = ${eventsJson};
const initialInfo = ${infoJson};
if (initialState && Object.keys(initialState).length) {
  renderState(initialState);
}
if (Array.isArray(initialEvents) && initialEvents.length) {
  renderEvents(initialEvents);
}
if (initialInfo) {
  infoEl.textContent = initialInfo;
}
window.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'state') {
    renderState(msg.state || {});
  }
  if (msg.type === 'events') {
    renderEvents(msg.events || []);
  }
  if (msg.type === 'info') {
    infoEl.textContent = msg.message || '';
  }
});
</script>
</body>
</html>`;
  }
}
