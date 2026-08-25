import * as vscode from "vscode";
import * as path from "path";

import { FileChange } from "./types";

const agentDiffResources = new Set<string>();

export async function showAgentDiffs(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  if (!changes.length) {
    throw new Error("There are no changes to preview.");
  }

  for (const change of changes) {
    await showSingleDiff(rootPath, change);
  }
}

async function showSingleDiff(
  rootPath: string,
  change: FileChange,
): Promise<void> {
  const filePath = resolveSafePath(rootPath, change.path);

  const language = detectLanguage(change.path);

  let originalUri: vscode.Uri;
  let proposedUri: vscode.Uri;

  if (change.operation === "create") {
    const proposedDocument = await vscode.workspace.openTextDocument({
      content: change.newContent ?? "",
      language,
    });

    const emptyDocument = await vscode.workspace.openTextDocument({
      content: "",
      language,
    });

    originalUri = emptyDocument.uri;

    proposedUri = proposedDocument.uri;
  } else if (change.operation === "delete") {
    const originalDocument = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );

    const emptyDocument = await vscode.workspace.openTextDocument({
      content: "",
      language,
    });

    originalUri = originalDocument.uri;

    proposedUri = emptyDocument.uri;
  } else {
    const originalDocument = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );

    const proposedDocument = await vscode.workspace.openTextDocument({
      content: change.newContent ?? "",
      language: originalDocument.languageId,
    });

    originalUri = originalDocument.uri;

    proposedUri = proposedDocument.uri;
  }

  agentDiffResources.add(originalUri.toString());

  agentDiffResources.add(proposedUri.toString());

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    proposedUri,
    buildDiffTitle(change),
    {
      viewColumn: vscode.ViewColumn.Beside,

      preserveFocus: true,

      preview: false,
    },
  );
}

export async function closeAgentDiffs(): Promise<void> {
  const tabsToClose: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as
        | {
            original?: vscode.Uri;
            modified?: vscode.Uri;
          }
        | undefined;

      if (!input) {
        continue;
      }

      const original = input.original?.toString();

      const modified = input.modified?.toString();

      const isAgentDiff =
        (original && agentDiffResources.has(original)) ||
        (modified && agentDiffResources.has(modified));

      if (isAgentDiff) {
        tabsToClose.push(tab);
      }
    }
  }

  for (const tab of tabsToClose) {
    try {
      await vscode.window.tabGroups.close(tab, true);
    } catch {
      // Ignore tabs that were
      // already closed.
    }
  }

  agentDiffResources.clear();
}

function buildDiffTitle(change: FileChange): string {
  switch (change.operation) {
    case "create":
      return `FreeCopilot: Create ${change.path}`;

    case "delete":
      return `FreeCopilot: Delete ${change.path}`;

    default:
      return `FreeCopilot: Modify ${change.path}`;
  }
}

function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  const languages: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".md": "markdown",
    ".php": "php",
  };

  return languages[extension] ?? "plaintext";
}

function resolveSafePath(rootPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  const absolutePath = path.resolve(rootPath, relativePath);

  const relativeFromRoot = path.relative(rootPath, absolutePath);

  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return absolutePath;
}
