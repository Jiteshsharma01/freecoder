import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function generateProjectContextMap(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('Please open a workspace project first!');
        return null;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    let mapOutput = `# 🗺️ Project Architecture Mapping\n\nGenerated on: ${new Date().toLocaleString()}\n\n`;
    
    async function traverse(currentDir: string, level = 0) {
        const directoryEntries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of directoryEntries) {
            // Filter global bloat blocks to optimize memory/tokens
            if (['node_modules', '.git', 'dist', 'build', '.VSCodeCounter'].includes(entry.name)) {
                continue;
            }
            
            const indent = '  '.repeat(level);
            if (entry.isDirectory()) {
                mapOutput += `${indent}- 📂 **${entry.name}/**\n`;
                await traverse(path.join(currentDir, entry.name), level + 1);
            } else {
                mapOutput += `${indent}- 📄 ${entry.name}\n`;
            }
        }
    }

    try {
        await traverse(rootPath);
        const destinationFile = path.join(rootPath, 'project_blueprint.md');
        await fs.writeFile(destinationFile, mapOutput, 'utf-8');
        
        // Auto-display document sheet panel array setup inside workbench
        const documentText = await vscode.workspace.openTextDocument(destinationFile);
        await vscode.window.showTextDocument(documentText);
        
        return destinationFile;
    } catch (err: any) {
        vscode.window.showErrorMessage(`Mapping Failed: ${err.message}`);
        return null;
    }
}
