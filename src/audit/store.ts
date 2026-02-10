import * as vscode from "vscode";

export class AuditStore {
  private readonly file: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.file = vscode.Uri.joinPath(context.globalStorageUri, "audit.jsonl");
  }

  async append(entry: Record<string, unknown>): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const line = JSON.stringify(entry) + "\n";
    let current: Uint8Array | undefined;
    try {
      current = await vscode.workspace.fs.readFile(this.file);
    } catch {
      // first write
    }
    const base = current ? Buffer.from(current) : Buffer.alloc(0);
    const next = Buffer.concat([base, Buffer.from(line, "utf8")]);
    await vscode.workspace.fs.writeFile(this.file, next);
  }

  async exportTo(target: vscode.Uri): Promise<void> {
    const data = await vscode.workspace.fs.readFile(this.file);
    await vscode.workspace.fs.writeFile(target, data);
  }
}
