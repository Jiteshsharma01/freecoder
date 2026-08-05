import * as vscode from 'vscode';
import * as path from 'path';
import { getChatHtml } from './chatHtml';
import { generateProjectContextMap } from './projectMapper';

export function activate(context: vscode.ExtensionContext) {

    // Register Workspace Map Core Action Command
    let mapCmd = vscode.commands.registerCommand('freeCopilot.generateProjectMap', async () => {
        const generatedFilePath = await generateProjectContextMap();
        if (generatedFilePath) {
            vscode.window.showInformationMessage(`Context Map successfully created at project root!`);
        }
    });
    context.subscriptions.push(mapCmd);

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
                case 'generateMap':
                    await generateProjectContextMap();
                    break;
                case 'sendMessage':
                    await this.handleChatMessage(data, webviewView);
                    break;
                case 'stopGeneration':
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = null;
                    }
                    break;
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

        // Fetch mapping layout data context string
        const workspaceTreeContext = await this.getActiveProjectContext();
        
        // Glue context details to user prompt
        const finalPromptWithContext = text + workspaceTreeContext;

        // Fire initialization container command to HTML frontend UI
        webviewView.webview.postMessage({ command: 'startStream', provider: 'Qwen3-Coder' });

        // 4. INSTANTIATE CONTROLLER: Hook a new token manager for this request lifecycle
        this._activeAbortController = new AbortController();

        try {
            if (provider === 'ollama-qwen3-local') {
                const OLLAMA_URL = "http://localhost:11434/api/chat";
                const payload = {
                    model: "qwen3-coder:30b",
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert workspace AI code assistant inside VS Code. You have full awareness of the developer's project directory tree structure provided in their prompt contexts."
                        },
                        {
                            role: "user",
                            content: finalPromptWithContext
                        }
                    ],
                    stream: true // Keep streaming processing enabled
                };

                const response = await fetch(OLLAMA_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    // 5. ATTACH SIGNAL: Binds the cancel listener straight into this fetch connection
                    signal: this._activeAbortController.signal 
                });

                if (!response.ok) { 
                    throw new Error(`Server returned HTTP ${response.status}`); 
                }

                // Setup Stream Reader Pipeline against network socket response body
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (!reader) { 
                    throw new Error("Could not initialize network response text stream reader."); 
                }

                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) { break; }

                    // Decode buffer segments
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");

                    // Keep incomplete trailing lines in buffer
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.trim() === "") { continue; }
                        
                        try {
                            const parsedChunk = JSON.parse(line);
                            const tokenText = parsedChunk.message?.content || "";
                            
                            if (tokenText) {
                                // Instantly post token fragments back up to UI panel log
                                webviewView.webview.postMessage({
                                    command: 'appendStream',
                                    text: tokenText
                                });
                            }
                        } catch (e) {
                            // Fail silently for unaligned chunk pieces
                        }
                    }
                }
                
                // Let frontend know streaming ended cleanly
                webviewView.webview.postMessage({ command: 'endStream' });

            } else {
                // Fallback mockup responses for secondary options
                webviewView.webview.postMessage({ 
                    command: 'appendStream', 
                    text: `🤖 Simulating legacy fallback processing for alternative engine option type: ${provider}` 
                });
                webviewView.webview.postMessage({ command: 'endStream' });
            }

        } catch (error: any) {
            // 6. CATCH ABORT: Do not show an error modal to the user if they triggered the cancel deliberately
            if (error.name === 'AbortError') {
                console.log('Ollama stream generation aborted by the user.');
            } else {
                // Forward genuine connection errors cleanly down into frontend view log window
                webviewView.webview.postMessage({ 
                    command: 'showError', 
                    text: `Ollama Connection Error: Failed to talk to local engine. Details: ${error.message}` 
                });
            }
        } finally {
            // Clear the tracking state for the next message run
            this._activeAbortController = null;
        }
    }
}

export function deactivate() {}
