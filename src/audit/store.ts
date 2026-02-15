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


  async readRecent(limit = 20): Promise<Record<string, unknown>[]> {
    let data: Uint8Array;
    try {
      data = await vscode.workspace.fs.readFile(this.file);
    } catch {
      return [];
    }

    const lines = Buffer.from(data)
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const recent = lines.slice(-Math.max(1, limit));
    return recent.map((line) => {
      try {
        const parsed = JSON.parse(line);
        return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
      } catch {
        return { raw: line };
      }
    });
  }

  async openInEditor(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    try {
      await vscode.workspace.fs.stat(this.file);
    } catch {
      await vscode.workspace.fs.writeFile(this.file, Buffer.from("", "utf8"));
    }

    const doc = await vscode.workspace.openTextDocument(this.file);
    await vscode.window.showTextDocument(doc, { preview: false });
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
