import * as vscode from 'vscode';
import * as path from 'path';
import { getChatHtml } from './chatHtml';
import { generateProjectContextMap } from './projectMapper';
import { generateKnowledgeGraph } from './projectAnalysis/knowledgeGraph/graphGenerator';
import { showKnowledgeGraph } from './projectAnalysis/knowledgeGraph/graphView';
import { analyzeProject } from './projectAnalysis/projectAnalyzer';
import { generateProjectMap } from './projectAnalysis/mappers/genericMapper';
import { getWorkspaceRoot } from './projectAnalysis/workspace';

export function activate(context: vscode.ExtensionContext) {

    // Register Workspace Map Core Action Command
    let mapCmd = vscode.commands.registerCommand('freeCopilot.generateProjectMap', async () => {
        const generatedFilePath = await generateProjectContextMap();
        if (generatedFilePath) {
            vscode.window.showInformationMessage(`Context Map successfully created at project root!`);
        }
    });
    const graphCmd = vscode.commands.registerCommand('freeCopilot.generateKnowledgeGraph', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('Please open a workspace project first!');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        try {
            // 1. Scan + detect + analyze project
            const analysis = await analyzeProject(rootPath);
            // 2. Generate graph from the analysis
            const graph = await generateKnowledgeGraph(analysis);
            // 3. Open graph visualization
            if (graph) {
                showKnowledgeGraph(context.extensionUri, graph);
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Knowledge graph generation failed: ${error.message}`
            );
        }
        }
    );
    context.subscriptions.push(mapCmd, graphCmd);

    // Register Webview View Sidebar Provider Container interface
    const chatProvider = new FreeCopilotViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'freeCopilot.chatView', 
            chatProvider,
            // 🔥 THE FIX: Pass the property here during registration so it binds to the sidebar lifecycle
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );
}

class FreeCopilotViewProvider implements vscode.WebviewViewProvider {
    // 1. Maintain a reference to the active AbortController to stop network streams
    private _activeAbortController: AbortController | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        // Keep it clean. Only assign basic options to the underlying webview document
        webviewView.webview.options = { 
            enableScripts: true 
        };
        
        webviewView.description = "Local Code Assistant";
        webviewView.webview.html = getChatHtml('');

        // Intercept incoming interface pipeline events 
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'generateMap': {
                    const rootPath = getWorkspaceRoot();
                    if (!rootPath) { break; }
                    try {
                        const analysis = await analyzeProject(rootPath);
                        await generateProjectMap(rootPath, analysis);
                        vscode.window.showInformationMessage('Project Overview generated.');
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Project mapping failed: ${error.message}`);
                    }
                    break;
                }
                case 'generateKnowledgeGraph': {
                    const rootPath = getWorkspaceRoot();
                    if (!rootPath) { break; }
                    try {
                        const analysis = await analyzeProject(rootPath);
                        const graph = await generateKnowledgeGraph(analysis);
                        if (graph) {
                            showKnowledgeGraph(this._extensionUri, graph);
                        }

                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Knowledge graph generation failed: ${error.message}`);
                    }
                    break;
                }
                case 'sendMessage':
                    await this.handleChatMessage(data, webviewView);
                    break;
                case 'stopGeneration':
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = null;
                    }
                    break;
                case 'requestClearConfirmation':{
                    const selection = await vscode.window.showWarningMessage(
                        "Are you sure you want to clear your entire chat history log?",
                        { modal: true }, // 'modal: true' makes it an overlay popup that prevents accidental misclicks
                        "Yes, Clear Everything"
                    );

                    // If the user explicitly selects the clear confirmation selection trigger, message the frontend to sweep
                    if (selection === "Yes, Clear Everything") {
                        webviewView.webview.postMessage({ command: 'executeConfirmedClear' });
                    }
                    break;
                }
            }
        });
    }

    // Reads explicitly from index 0 of the workspace array to eliminate compile errors
    private async getActiveProjectContext(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) { 
            return ""; 
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const blueprintPath = path.join(rootPath, 'project_blueprint.md');

        try {
            // Read file contents cleanly via native VS Code FileSystem API
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(blueprintPath));
            const blueprintData = new TextDecoder('utf-8').decode(bytes);
            
            return `\n\n[CONTEXT: Here is the current workspace directory structure tree for reference]\n${blueprintData}`;
        } catch {
            // Silent fallback if they haven't clicked the map generation button yet
            return "";
        }
    }

    // Fully converted to real-time NDJSON chunk stream handling with Abort Signal integration
    private async handleChatMessage(data: any, webviewView: vscode.WebviewView) {
        const { text, provider, attachment, attachmentType } = data;

        // Block multi-modal payloads from dropping into local textual models
        if (attachment && attachmentType?.startsWith('image/')) {
            if (provider === 'ollama-qwen3-local') {
                webviewView.webview.postMessage({ 
                    command: 'showError', 
                    text: 'Local Ollama Error: qwen3-coder:30b is a text model and does not support image uploads.' 
                });
                return;
            }
        }

        // Check for file attachments first (Always processed if present)
        let attachedFileContext = "";
        const hasFileAttachment = attachment && !attachmentType?.startsWith('image/');
        if (hasFileAttachment) {
            attachedFileContext = `\n\n[USER ATTACHED FILE CONTEXT]\n\`\`\`\n${attachment}\n\`\`\``;
        }

        // SMART CHECK: Look for project context triggers in the user's prompt text
        const lowerText = text.toLowerCase();
        const needsProjectTreeMap = 
            lowerText.includes("project") || 
            lowerText.includes("my code") || 
            lowerText.includes("this file") || 
            lowerText.includes("workspace") || 
            lowerText.includes("structure") || 
            lowerText.includes("repository") ||
            lowerText.includes("this app") ||
            lowerText.includes("blueprint");

        let finalPromptWithContext = text + attachedFileContext;

        // Only fetch and append the project tree if context is actually requested
        if (needsProjectTreeMap) {
            const workspaceTreeContext = await this.getActiveProjectContext();
            finalPromptWithContext += workspaceTreeContext;
        }

        // Fire initialization container command to HTML frontend UI
        webviewView.webview.postMessage({ command: 'startStream', provider: 'Qwen3-Coder' });

        this._activeAbortController = new AbortController();

        try {
            if (provider === 'ollama-qwen3-local') {
                const OLLAMA_URL = "http://localhost:11434/api/chat";
                
                // Update the System Prompt to guide the model on how to behave with or without context or attachment
                let systemMessage = "You are an expert programming tutor and developer assistant.";
                if (hasFileAttachment && needsProjectTreeMap) {
                    systemMessage = "You are an expert workspace AI assistant. You have full context of the uploaded file AND the developer's project directory tree map layout.";
                } else if (hasFileAttachment) {
                    systemMessage = "You are an expert programming assistant. Analyze the specific file context attached by the user to answer their question directly.";
                } else if (needsProjectTreeMap) {
                    systemMessage = "You are an expert architectural AI assistant. Review the provided workspace folder map blueprint to guide the user.";
                }

                const payload = {
                    model: "qwen3-coder:30b",
                    messages: [
                        {
                            role: "system",
                            content: systemMessage
                        },
                        {
                            role: "user",
                            content: finalPromptWithContext
                        }
                    ],
                    stream: true
                };

                const response = await fetch(OLLAMA_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: this._activeAbortController.signal 
                });

                if (!response.ok) { 
                    throw new Error(`Server returned HTTP ${response.status}`); 
                }

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (!reader) { 
                    throw new Error("Could not initialize network response text stream reader."); 
                }

                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) { break; }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.trim() === "") { continue; }
                        
                        try {
                            const parsedChunk = JSON.parse(line);
                            const tokenText = parsedChunk.message?.content || "";
                            
                            if (tokenText) {
                                webviewView.webview.postMessage({
                                    command: 'appendStream',
                                    text: tokenText
                                });
                            }
                        } catch (e) {}
                    }
                }
                
                webviewView.webview.postMessage({ command: 'endStream' });

            } else {
                webviewView.webview.postMessage({ 
                    command: 'appendStream', 
                    text: `🤖 Simulating legacy fallback processing for alternative engine option type: ${provider}` 
                });
                webviewView.webview.postMessage({ command: 'endStream' });
            }

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Ollama stream generation aborted by the user.');
            } else {
                webviewView.webview.postMessage({ 
                    command: 'showError', 
                    text: `Ollama Connection Error: Failed to talk to local engine. Details: ${error.message}` 
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }
}

export function deactivate() {}
