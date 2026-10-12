import * as vscode from "vscode";

export const FREECOPILOT_DIFF_SCHEME = "freecopilot-diff";

interface VirtualDocumentEntry {
  uri: vscode.Uri;
  content: string;
  originalPath: string;
}

export class FreeCopilotDiffProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly documents = new Map<string, VirtualDocumentEntry>();

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this._onDidChange.event;

  public provideTextDocumentContent(
    uri: vscode.Uri,
    _token: vscode.CancellationToken,
  ): string {
    const entry = this.documents.get(uri.toString());

    return entry?.content ?? "";
  }

  public setDocument(
    uri: vscode.Uri,
    content: string,
    originalPath: string,
  ): void {
    const key = uri.toString();

    this.documents.set(key, {
      uri,
      content,
      originalPath,
    });

    this._onDidChange.fire(uri);
  }

  public removeDocument(uri: vscode.Uri): void {
    this.documents.delete(uri.toString());
  }

  public hasDocument(uri: vscode.Uri): boolean {
    return this.documents.has(uri.toString());
  }

  public clear(): void {
    this.documents.clear();
  }

  public dispose(): void {
    this._onDidChange.dispose();
    this.documents.clear();
  }
}

export function createDiffUri(
  changePath: string,
  side: "proposed" | "empty",
): vscode.Uri {
  const encodedPath = encodeURIComponent(changePath.replace(/\\/g, "/"));

  return vscode.Uri.parse(
    `${FREECOPILOT_DIFF_SCHEME}://diff/${encodedPath}?side=${side}`,
  );
}
