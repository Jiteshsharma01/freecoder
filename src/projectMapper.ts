import * as vscode from 'vscode';
import { analyzeProject } from './projectAnalysis/projectAnalyzer';
import { generateProjectMap } from './projectAnalysis/mappers/genericMapper';

export async function generateProjectContextMap(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('Please open a workspace project first!');
        return null;
    }

    try {
        const analysis = await analyzeProject(
            workspaceFolders[0].uri.fsPath
        );
        return await generateProjectMap(
            workspaceFolders[0].uri.fsPath,
            analysis
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Project mapping failed: ${error.message}`);
        return null;
    }
}