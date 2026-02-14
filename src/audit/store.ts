import * as vscode from "vscode";
import { appendFile, copyFile } from "node:fs/promises";

export class AuditStore {
  private readonly file: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.file = vscode.Uri.joinPath(context.globalStorageUri, "audit.jsonl");
  }

  async append(entry: Record<string, unknown>): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const line = JSON.stringify(entry) + "\n";

    if (this.file.scheme === "file") {
      await appendFile(this.file.fsPath, line, "utf8");
      return;
    }

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
    if (this.file.scheme === "file" && target.scheme === "file") {
      try {
        await copyFile(this.file.fsPath, target.fsPath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new Error("No audit entries available to export yet.");
        }
        throw err;
      }
    }

    try {
      const data = await vscode.workspace.fs.readFile(this.file);
      await vscode.workspace.fs.writeFile(target, data);
    } catch {
      throw new Error("No audit entries available to export yet.");
    }
  }
}
