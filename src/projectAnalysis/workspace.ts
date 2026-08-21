import * as vscode from 'vscode';

export function getWorkspaceRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Please open a workspace project first!');
        return null;
    }
    return workspaceFolders[0].uri.fsPath;
}