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

  /*
   * Validate every change before creating
   * the WorkspaceEdit.
   *
   * Delete operations are explicitly supported.
   */
  await verifyFilesHaveNotChanged(rootPath, changes);

  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const change of changes) {
    const absolutePath = resolveSafePath(rootPath, change.path);

    const uri = vscode.Uri.file(absolutePath);

    switch (change.operation) {
      case "create": {
        if (change.newContent === undefined) {
          throw new Error(`Missing content for new file: ${change.path}`);
        }

        /*
         * Make sure create really is a new file.
         */
        const exists = await fileExists(uri);

        if (exists) {
          throw new Error(`File already exists: ${change.path}`);
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

        const exists = await fileExists(uri);

        if (!exists) {
          throw new Error(`File no longer exists: ${change.path}`);
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
        /*
         * This is intentionally checked separately
         * from modify.
         */
        const exists = await fileExists(uri);

        if (!exists) {
          throw new Error(`File no longer exists: ${change.path}`);
        }

        workspaceEdit.deleteFile(uri, {
          ignoreIfNotExists: false,
          recursive: false,
        });

        break;
      }

      case "rename": {
        if (!change.originalPath || !change.newPath) {
          throw new Error(
            `Rename requires originalPath and newPath: ${change.path}`,
          );
        }

        const oldUri = vscode.Uri.file(
          resolveSafePath(rootPath, change.originalPath),
        );

        const newUri = vscode.Uri.file(
          resolveSafePath(rootPath, change.newPath),
        );

        const sourceExists = await fileExists(oldUri);

        if (!sourceExists) {
          throw new Error(
            `File to rename no longer exists: ${change.originalPath}`,
          );
        }

        const destinationExists = await fileExists(newUri);

        if (destinationExists) {
          throw new Error(
            `Rename destination already exists: ${change.newPath}`,
          );
        }

        workspaceEdit.renameFile(oldUri, newUri, {
          overwrite: false,
          ignoreIfExists: false,
        });

        break;
      }

      default: {
        throw new Error(
          `Unsupported change operation: ${(change as FileChange).operation}`,
        );
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
    /*
     * ---------------------------------------------------------
     * CREATE
     * ---------------------------------------------------------
     *
     * The target must still NOT exist.
     * ---------------------------------------------------------
     */
    if (change.operation === "create") {
      const absolutePath = resolveSafePath(rootPath, change.path);

      const uri = vscode.Uri.file(absolutePath);

      const exists = await fileExists(uri);

      if (exists) {
        throw new Error(
          `File was created while the Agent was working: ${change.path}. Regenerate the change.`,
        );
      }

      continue;
    }

    /*
     * ---------------------------------------------------------
     * RENAME
     * ---------------------------------------------------------
     *
     * For rename:
     *
     * originalPath = existing file
     * newPath      = destination
     *
     * We must verify:
     *
     * 1. Original file still exists.
     * 2. Destination does not already exist.
     * 3. Original file has not changed since the Agent
     *    generated the proposal.
     * ---------------------------------------------------------
     */
    if (change.operation === "rename") {
      if (!change.originalPath || !change.newPath) {
        throw new Error(
          `Invalid rename operation for ${change.path}: originalPath and newPath are required.`,
        );
      }

      const originalAbsolutePath = resolveSafePath(
        rootPath,
        change.originalPath,
      );

      const newAbsolutePath = resolveSafePath(rootPath, change.newPath);

      const originalUri = vscode.Uri.file(originalAbsolutePath);

      const newUri = vscode.Uri.file(newAbsolutePath);

      /*
       * Source/original file must still exist.
       */
      const originalExists = await fileExists(originalUri);

      if (!originalExists) {
        throw new Error(
          `File to rename no longer exists: ${change.originalPath}`,
        );
      }

      /*
       * Destination must still be free.
       */
      const destinationExists = await fileExists(newUri);

      if (destinationExists) {
        throw new Error(`Rename destination already exists: ${change.newPath}`);
      }

      /*
       * Snapshot protection.
       *
       * The file may still exist but the developer may
       * have modified it after the Agent generated the plan.
       */
      if (change.originalContent !== undefined) {
        const document = await vscode.workspace.openTextDocument(originalUri);

        const currentContent = document.getText();

        if (currentContent !== change.originalContent) {
          throw new Error(
            [
              `File changed after the Agent generated the rename: ${change.originalPath}.`,
              "Please regenerate the Agent changes.",
            ].join(" "),
          );
        }
      }

      continue;
    }

    /*
     * ---------------------------------------------------------
     * MODIFY / DELETE
     * ---------------------------------------------------------
     *
     * Both operations operate on the existing file.
     * ---------------------------------------------------------
     */
    const absolutePath = resolveSafePath(rootPath, change.path);

    const uri = vscode.Uri.file(absolutePath);

    const exists = await fileExists(uri);

    if (!exists) {
      throw new Error(`File no longer exists: ${change.path}`);
    }

    /*
     * Snapshot protection.
     *
     * This prevents stale Agent changes from overwriting
     * developer changes.
     */
    if (change.originalContent !== undefined) {
      const document = await vscode.workspace.openTextDocument(uri);

      const currentContent = document.getText();

      if (currentContent !== change.originalContent) {
        throw new Error(
          [
            `File changed after the Agent generated the proposal: ${change.path}.`,
            "Please regenerate the Agent changes.",
          ].join(" "),
        );
      }
    }
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);

    return true;
  } catch {
    return false;
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

function resolveSafePathForUndo(
  rootPath: string,
  relativePath: string,
): string {
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

export async function captureAppliedSnapshots(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  for (const change of changes) {
    /*
     * ---------------------------------------------------------
     * CREATE / MODIFY
     * ---------------------------------------------------------
     */
    if (change.operation === "create" || change.operation === "modify") {
      const absolutePath = resolveSafePath(rootPath, change.path);
      const uri = vscode.Uri.file(absolutePath);
      const exists = await fileExists(uri);
      if (!exists) {
        throw new Error(
          `Unable to capture applied content for ${change.path}: file does not exist after applying changes.`,
        );
      }
      const document = await vscode.workspace.openTextDocument(uri);
      change.appliedContent = document.getText();
      continue;
    }

    /*
     * ---------------------------------------------------------
     * DELETE
     * ---------------------------------------------------------
     *
     * There is no content after deletion.
     */
    if (change.operation === "delete") {
      change.appliedContent = undefined;
      continue;
    }

    /*
     * ---------------------------------------------------------
     * RENAME
     * ---------------------------------------------------------
     *
     * Read the content from the NEW path because that is
     * where the file now lives.
     */
    if (change.operation === "rename") {
      if (!change.newPath) {
        throw new Error(
          `Unable to capture applied content for rename: newPath is missing.`,
        );
      }
      const absolutePath = resolveSafePath(rootPath, change.newPath);
      const uri = vscode.Uri.file(absolutePath);
      const exists = await fileExists(uri);
      if (!exists) {
        throw new Error(
          `Unable to capture applied content for renamed file: ${change.newPath}`,
        );
      }
      const document = await vscode.workspace.openTextDocument(uri);
      change.appliedContent = document.getText();
      continue;
    }

    throw new Error(
      `Unsupported Agent operation while capturing applied snapshot: ${change.operation}`,
    );
  }
}

export async function verifyChangesCanBeUndone(
  rootPath: string,
  changes: FileChange[],
): Promise<void> {
  for (const change of changes) {
    /*
     * -------------------------------------------------------
     * CREATE
     *
     * The Agent created the file.
     * It should still contain exactly the Agent-generated
     * content before we delete it.
     * -------------------------------------------------------
     */
    if (change.operation === "create") {
      const absolutePath = resolveSafePathForUndo(rootPath, change.path);
      const uri = vscode.Uri.file(absolutePath);
      const exists = await fileExists(uri);
      if (!exists) {
        throw new Error(
          `Cannot undo creation of ${change.path}: the file no longer exists.`,
        );
      }

      if (change.appliedContent !== undefined) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.getText() !== change.appliedContent) {
          throw new Error(
            `Cannot undo ${change.path}: the file was modified after the Agent created it.`,
          );
        }
      }
      continue;
    }

    /*
     * -------------------------------------------------------
     * DELETE
     *
     * The Agent deleted the file.
     * It should still be absent.
     * -------------------------------------------------------
     */
    if (change.operation === "delete") {
      const absolutePath = resolveSafePathForUndo(rootPath, change.path);
      const uri = vscode.Uri.file(absolutePath);
      const exists = await fileExists(uri);
      if (exists) {
        throw new Error(
          `Cannot undo ${change.path}: the file has been recreated or changed after the Agent deleted it.`,
        );
      }
      continue;
    }

    /*
     * -------------------------------------------------------
     * RENAME
     * -------------------------------------------------------
     */
    if (change.operation === "rename") {
      if (!change.originalPath || !change.newPath) {
        throw new Error(
          `Cannot undo rename ${change.path}: originalPath and newPath are required.`,
        );
      }
      const currentUri = vscode.Uri.file(
        resolveSafePathForUndo(rootPath, change.newPath),
      );
      const originalUri = vscode.Uri.file(
        resolveSafePathForUndo(rootPath, change.originalPath),
      );
      const currentExists = await fileExists(currentUri);
      if (!currentExists) {
        throw new Error(
          `Cannot undo rename: ${change.newPath} no longer exists.`,
        );
      }
      const originalExists = await fileExists(originalUri);
      if (originalExists) {
        throw new Error(
          `Cannot undo rename: original path already exists: ${change.originalPath}`,
        );
      }
      if (change.appliedContent !== undefined) {
        const document = await vscode.workspace.openTextDocument(currentUri);
        if (document.getText() !== change.appliedContent) {
          throw new Error(
            `Cannot undo ${change.newPath}: the file was modified after the Agent renamed it.`,
          );
        }
      }
      continue;
    }

    /*
     * -------------------------------------------------------
     * MODIFY
     *
     * The current content must still equal the content
     * generated by the Agent.
     * -------------------------------------------------------
     */
    if (change.operation === "modify") {
      const absolutePath = resolveSafePathForUndo(rootPath, change.path);
      const uri = vscode.Uri.file(absolutePath);
      const exists = await fileExists(uri);
      if (!exists) {
        throw new Error(
          `Cannot undo ${change.path}: the file no longer exists.`,
        );
      }
      if (change.appliedContent !== undefined) {
        const document = await vscode.workspace.openTextDocument(uri);
        const currentContent = document.getText();
        if (currentContent !== change.appliedContent) {
          throw new Error(
            `Cannot undo ${change.path}: the file was modified after the Agent applied its changes.`,
          );
        }
      }
    }
  }
}
