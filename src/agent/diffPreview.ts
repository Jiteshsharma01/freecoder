import * as vscode from "vscode";
import * as path from "path";

import { FileChange } from "./types";

import { FreeCoderDiffProvider, createDiffUri } from "./virtualDiffProvider";

const agentDiffResources = new Set<string>();

export async function showAgentDiffs(
  rootPath: string,
  changes: FileChange[],
  diffProvider: FreeCoderDiffProvider,
): Promise<void> {
  if (changes.length === 0) {
    throw new Error("There are no changes to preview.");
  }

  for (const change of changes) {
    await showSingleDiff(rootPath, change, diffProvider);
  }
}

async function showSingleDiff(
  rootPath: string,
  change: FileChange,
  diffProvider: FreeCoderDiffProvider,
): Promise<void> {
  const absolutePath = resolveSafePath(rootPath, change.path);

  const originalUri = vscode.Uri.file(absolutePath);

  let leftUri: vscode.Uri;

  let rightUri: vscode.Uri;

  /*
   * MODIFY
   *
   * Real file on the left.
   * Read-only virtual proposed file on the right.
   */
  if (change.operation === "modify") {
    leftUri = originalUri;

    rightUri = createDiffUri(change.path, "proposed");

    diffProvider.setDocument(rightUri, change.newContent ?? "", change.path);
  } else if (change.operation === "create") {

  /*
   * CREATE
   *
   * Empty virtual document on the left.
   * Read-only virtual proposed document on the right.
   */
    leftUri = createDiffUri(change.path, "empty");

    rightUri = createDiffUri(change.path, "proposed");

    diffProvider.setDocument(leftUri, "", change.path);

    diffProvider.setDocument(rightUri, change.newContent ?? "", change.path);
  } else if (change.operation === "delete") {

  /*
   * DELETE
   *
   * Real file on the left.
   * Empty virtual document on the right.
   */
    leftUri = originalUri;

    rightUri = createDiffUri(change.path, "empty");

    diffProvider.setDocument(rightUri, "", change.path);
  } else {
    throw new Error(`Unsupported Agent change operation: ${change.operation}`);
  }

  /*
   * Track every virtual resource belonging
   * to this Agent diff.
   */
  if (leftUri.scheme === "freecoder-diff") {
    agentDiffResources.add(leftUri.toString());
  }

  if (rightUri.scheme === "freecoder-diff") {
    agentDiffResources.add(rightUri.toString());
  }

  /*
   * Open the actual VS Code diff.
   *
   * This is the known-good command shape.
   */
  await vscode.commands.executeCommand(
    "vscode.diff",
    leftUri,
    rightUri,
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
      // Ignore tabs that were already closed.
    }
  }

  agentDiffResources.clear();
}

export function clearAgentDiffResources(): void {
  agentDiffResources.clear();
}

function buildDiffTitle(change: FileChange): string {
  switch (change.operation) {
    case "create":
      return `FreeCoder: Create ${change.path}`;

    case "delete":
      return `FreeCoder: Delete ${change.path}`;

    case "modify":
      return `FreeCoder: Modify ${change.path}`;

    default:
      return `FreeCoder: ${change.path}`;
  }
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
