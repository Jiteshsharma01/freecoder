import * as vscode from "vscode";
import * as path from "path";

import { FileChange } from "./types";

export async function applyFileChanges(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  if (changes.length === 0) {
    throw new Error("There are no changes to apply.");
  }

  await verifyFilesHaveNotChanged(rootPath, changes);

  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const change of changes) {
    const uri = vscode.Uri.file(resolveSafePath(rootPath, change.path));

    switch (change.operation) {
      case "create": {
        if (change.newContent === undefined) {
          throw new Error(`Missing content for new file: ${change.path}`);
        }

        workspaceEdit.createFile(uri, {
          overwrite: false,
          ignoreIfExists: false,
        });

        workspaceEdit.insert(uri, new vscode.Position(0, 0), change.newContent);

        break;
      }

      case "modify": {
        if (change.newContent === undefined) {
          throw new Error(`Missing new content for: ${change.path}`);
        }

        const document = await vscode.workspace.openTextDocument(uri);

        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        );

        workspaceEdit.replace(uri, fullRange, change.newContent);

        break;
      }

      case "delete": {
        workspaceEdit.deleteFile(uri, {
          ignoreIfNotExists: false,
          recursive: false,
        });

        break;
      }
    }
  }

  const applied = await vscode.workspace.applyEdit(workspaceEdit);

  if (!applied) {
    throw new Error("VS Code rejected the workspace changes.");
  }

  await saveModifiedDocuments(rootPath, changes);
}

async function verifyFilesHaveNotChanged(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  for (const change of changes) {
    const absolutePath = resolveSafePath(rootPath, change.path);

    const uri = vscode.Uri.file(absolutePath);

    if (change.operation === "create") {
      try {
        await vscode.workspace.fs.stat(uri);

        throw new Error(`File was created after the plan: ${change.path}`);
      } catch (error: any) {
        if (error?.code === "FileNotFound") {
          continue;
        }

        if (error?.message?.includes("File was created after the plan")) {
          throw error;
        }

        // VS Code can surface stat errors
        // differently. Treat unknown errors as missing.
        continue;
      }
    }

    if (change.operation === "delete" || change.operation === "modify") {
      let currentContent: string;

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);

        currentContent = new TextDecoder("utf-8").decode(bytes);
      } catch {
        throw new Error(`File no longer exists: ${change.path}`);
      }

      if (change.originalContent !== currentContent) {
        throw new Error(
          `File changed after the AI generated the diff: ${change.path}. Please regenerate the changes.`,
        );
      }
    }
  }
}

async function saveModifiedDocuments(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  for (const change of changes) {
    if (change.operation === "delete") {
      continue;
    }

    const uri = vscode.Uri.file(resolveSafePath(rootPath, change.path));

    try {
      const document = await vscode.workspace.openTextDocument(uri);

      if (document.isDirty) {
        await document.save();
      }
    } catch {
      // The WorkspaceEdit has already been applied.
    }
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
