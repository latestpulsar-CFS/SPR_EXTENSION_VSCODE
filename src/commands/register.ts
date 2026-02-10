import * as vscode from "vscode";
import { AuditStore } from "../audit/store";
import { isPrimusPhraseValid, requestPrimusCredentials } from "../auth/primus";
import { executePriorityMutation } from "../spher/amAgent";
import { classifyIntent } from "../spher/policy";
import { SpherClient } from "../spher/client";
import { SpherPanel } from "../ui/panel";

export interface CommandDeps {
  client: SpherClient;
  panel: SpherPanel;
  audit: AuditStore;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  computeUiUrl: () => string;
  amAgentConfig: () => {
    amAgentPath: string;
    allowCargoFallback: boolean;
    orchestratorManifestPath: string;
  };
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("spher.connectLocal", async () => {
      try {
        const state = await deps.client.getState();
        deps.panel.updateState(state);
        deps.panel.info("Connected to local SPHER.");
        await deps.audit.append({ ts: new Date().toISOString(), action: "connect", ok: true, state });
        vscode.window.showInformationMessage("SPHER local connected.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.panel.info(msg);
        await deps.audit.append({ ts: new Date().toISOString(), action: "connect", ok: false, error: msg });
        vscode.window.showErrorMessage(`SPHER connect failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("spher.setApiToken", async () => {
      const token = await vscode.window.showInputBox({
        title: "SPHER API Token",
        prompt: "Paste bearer token (empty to clear)",
        password: true,
        ignoreFocusOut: true
      });
      if (token === undefined) {
        return;
      }
      if (!token.trim()) {
        await deps.clearToken();
        vscode.window.showInformationMessage("SPHER token cleared.");
        return;
      }
      await deps.setToken(token.trim());
      vscode.window.showInformationMessage("SPHER token saved in VS Code SecretStorage.");
    }),

    vscode.commands.registerCommand("spher.runGovernedAction", async () => {
      const action = await vscode.window.showInputBox({
        title: "SPHER Governed Action",
        prompt: "Describe command or action",
        ignoreFocusOut: true
      });
      if (!action) {
        return;
      }
      const mode = classifyIntent(action);
      if (mode === "mutating") {
        const creds = await requestPrimusCredentials();
        if (!creds || !isPrimusPhraseValid(creds.phrase)) {
          await deps.audit.append({ ts: new Date().toISOString(), action, mode, ok: false, blocked: "primus_auth_failed" });
          vscode.window.showWarningMessage("Mutation denied: PR1MUS authorization failed.");
          return;
        }

        try {
          const result = await executePriorityMutation(deps.amAgentConfig(), action, creds);
          const authParsed = (result.auth.parsed as Record<string, unknown> | undefined) ?? {};
          const status = String(authParsed.status ?? "");
          const ok = result.auth.ok && status === "priority_executed";
          await deps.audit.append({
            ts: new Date().toISOString(),
            action,
            mode,
            ok,
            am_priority: result
          });
          if (ok) {
            vscode.window.showInformationMessage("Mutation executed via AM::PRIORITY path.");
          } else {
            vscode.window.showErrorMessage("AM priority mutation failed. Check audit/proof output.");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await deps.audit.append({ ts: new Date().toISOString(), action, mode, ok: false, error: msg });
          vscode.window.showErrorMessage(`Mutation path failed: ${msg}`);
        }
        return;
      }

      try {
        const response = await deps.client.runReadOnlyAction(action);
        await deps.audit.append({ ts: new Date().toISOString(), action, mode, ok: true, response });
        vscode.window.showInformationMessage("Read-only governed action submitted.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await deps.audit.append({ ts: new Date().toISOString(), action, mode, ok: false, error: msg });
        vscode.window.showErrorMessage(`Governed action failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("spher.toggleStrict", async () => {
      const cfg = vscode.workspace.getConfiguration("spher");
      const current = cfg.get<boolean>("strictMode", true);
      await cfg.update("strictMode", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`SPHER strict mode: ${!current ? "ON" : "OFF"}`);
    }),

    vscode.commands.registerCommand("spher.showProof", async () => {
      try {
        const latest = await deps.client.getLatest();
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: JSON.stringify(latest, null, 2)
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unable to fetch proof/latest event: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("spher.exportAudit", async () => {
      const target = await vscode.window.showSaveDialog({
        filters: { JSONL: ["jsonl"], JSON: ["json"] },
        saveLabel: "Export SPHER Audit"
      });
      if (!target) {
        return;
      }
      await deps.audit.exportTo(target);
      vscode.window.showInformationMessage(`SPHER audit exported to ${target.fsPath}`);
    }),

    vscode.commands.registerCommand("spher.openComputeUi", async () => {
      const url = deps.computeUiUrl();
      try {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unable to open compute UI (${url}): ${msg}`);
      }
    })
  );
}
