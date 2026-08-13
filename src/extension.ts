import * as vscode from 'vscode';
import * as path from 'path';
import { ProxyAgent } from 'undici';
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

    private getFetchRequestOptions(): any {
        const config = vscode.workspace.getConfiguration('freeCopilot');
        const proxyUrl = config.get<string>('proxy')?.trim() || "";

        const options: any = {
            signal: this._activeAbortController?.signal
        };

        // If the user specified a custom network tunnel, intercept fetch options
        if (proxyUrl) {
            try {
                // Assign the ProxyAgent dispatcher to force fetch through the corporate gateway
                options.dispatcher = new ProxyAgent({ uri: proxyUrl });
            } catch (e: any) {
                vscode.window.showErrorMessage(`Invalid Proxy URL Configuration: ${e.message}`);
            }
        }

        return options;
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

    private async callCloudGemini(promptText: string, attachmentBase64: string | null, webviewView: vscode.WebviewView) {
        const config = vscode.workspace.getConfiguration('freeCopilot');
        const GEMINI_API_KEY = config.get<string>('geminiKey') || ""; 

        if (!GEMINI_API_KEY) {
            throw new Error("Missing Gemini API Key! Configure it in Settings.");
        }

        // UPDATED: Target standard content delivery endpoint to bypass Node network socket hanging bugs
        const url = `https://googleapis.com{GEMINI_API_KEY}`;
        
        let partsArray: any[] = [];

        // Safe attachment parsing loop
        if (attachmentBase64 && attachmentBase64.includes(',')) {
            try {
                const parts = attachmentBase64.split(',');
                const base64Data = parts[1];
                const mimeMatch = parts[0].match(/data:(.*?);/);
                const mimeType = mimeMatch ? mimeMatch[1] : "text/plain";

                partsArray.push({ inlineData: { mimeType: mimeType, data: base64Data } });
            } catch (e) {
                // Fallback quietly if string indexing splits fail
            }
        }

        // Always push the user's primary prompt text into parts array
        partsArray.push({ text: promptText });

        const payload = {
            contents: [{ parts: partsArray }]
        };

        // const response = await globalThis.fetch(url, {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify(payload),
        //     signal: this._activeAbortController?.signal
        // });
        const requestOptions = this.getFetchRequestOptions();
        const response = await globalThis.fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            ...requestOptions // Dynamically injects proxy dispatcher and abort signals
        });

        if (!response.ok) { 
            throw new Error(`Gemini Cloud API rejected request with code HTTP ${response.status}`); 
        }

        const data = await response.json() as any;
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Received empty text back from Gemini.";
        
        // Pipeline text block back to thin-scroll HTML viewer
        webviewView.webview.postMessage({ command: 'appendStream', text: responseText });
    }

    private async callCloudHuggingFace(promptText: string, webviewView: vscode.WebviewView) {
        const config = vscode.workspace.getConfiguration('freeCopilot');
        const HF_TOKEN = config.get<string>('huggingFaceToken') || "";

        if (!HF_TOKEN) {
            throw new Error("Missing Hugging Face Token! Configure it in Settings.");
        }

        // FIXED: Corrected the serverless inference path to use the global endpoint
        const url = "https://api-inference.huggingface.co/v1/chat/completions";

        const payload = {
            model: "mistralai/Mistral-7B-Instruct-v0.3", // Specify model explicitly inside payload
            messages: [{ role: "user", content: promptText }],
            stream: true,
            max_tokens: 1000
        };

        const requestOptions = this.getFetchRequestOptions();
        const response = await globalThis.fetch(url, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json" 
            },
            body: JSON.stringify(payload),
            signal: this._activeAbortController?.signal,
            ...requestOptions
        });

        if (!response.ok) { 
            // Read errors from backend if 403 or 400 persists
            const errText = await response.text();
            throw new Error(`Hugging Face server returned ${response.status} - ${errText}`); 
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) return;

        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const cleanLine = line.trim();
                if (!cleanLine.startsWith("data:")) continue;
                
                const dataStr = cleanLine.substring(5).trim();
                if (dataStr === "[DONE]") break;

                try {
                    const parsed = JSON.parse(dataStr);
                    const deltaToken = parsed.choices?.[0]?.delta?.content || "";
                    if (deltaToken) {
                        webviewView.webview.postMessage({ command: 'appendStream', text: deltaToken });
                    }
                } catch {
                    // Keep gathering line buffers if splits happen mid-token
                }
            }
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

            } else if (provider === 'gemini-cloud') {
                // Stream text and files directly to Google's cloud server
                await this.callCloudGemini(finalPromptWithContext, attachment, webviewView);
                webviewView.webview.postMessage({ command: 'endStream' });
            } else if (provider === 'huggingface-cloud') {
                // Route to serverless inference text nodes
                await this.callCloudHuggingFace(finalPromptWithContext, webviewView);
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
                webviewView.webview.postMessage({ command: 'appendStream', text: "\n\n🛑 *Generation stopped by developer.*" });
            } else {
                webviewView.webview.postMessage({ command: 'showError', text: `Cloud API Failure Error: ${error.message}` });
            }
        } finally {
            this._activeAbortController = null;
        }
    }
}

export function deactivate() {}
