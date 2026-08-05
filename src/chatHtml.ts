export function getChatHtml(webviewUri: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: sans-serif; padding: 10px; display: flex; flex-direction: column; height: 100vh; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); box-sizing: border-box; margin: 0; }
            select, button, textarea { width: 100%; margin-bottom: 8px; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-dropdown-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); box-sizing: border-box; }
            button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; font-weight: bold; }
            button:hover { background: var(--vscode-button-hoverBackground); }
            #chat-log { flex-grow: 1; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 8px; margin-bottom: 8px; border-radius: 4px; background: var(--vscode-editor-background); font-size: 13px; }
            .msg { margin-bottom: 10px; padding: 6px; border-radius: 4px; }
            .user-msg { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); }
            .ai-msg { background: var(--vscode-textCodeBlock-background); }
            textarea { resize: none; height: 60px; }
            .row { display: flex; gap: 5px; }
            #file-preview { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
            .stream-content { white-space: pre-wrap; font-family: monospace; }
            
            /* Styled stop button */
            #stop-btn { background: var(--vscode-statusBarItem-errorBackground, #c74242); color: white; display: none; margin-top: 4px; }
            #stop-btn:hover { background: #b03535; }
        </style>
    </head>
    <body>

        <!-- 1. Model Selection -->
        <label for="provider">AI Provider Tool:</label>
        <select id="provider">
            <option value="ollama-qwen3-local">Local Ollama (Qwen3-Coder:30b)</option>
            <option value="gemini">Gemini Flash (Free Tier)</option>
            <option value="huggingface">Hugging Face API</option>
        </select>

        <!-- 2. Project Map Trigger Button -->
        <button id="map-btn">🗺️ Generate Project Structure Map</button>

        <!-- 3. Dynamic Message History Container -->
        <div id="chat-log"></div>

        <!-- Attachment UI Display Area -->
        <div id="file-preview">No file attached</div>

        <!-- 4. Input Controls -->
        <div class="row">
            <button id="upload-trigger" style="width: 40px;">📎</button>
            <input type="file" id="file-input" style="display: none;" accept="image/*,.txt,.md,.json,.js,.ts" />
            <textarea id="user-input" placeholder="Ask a question or request code..."></textarea>
        </div>
        <button id="send-btn">Send Message</button>
        
        <!-- NEW STOP BUTTON -->
        <button id="stop-btn">⏹️ Stop Generating</button>

        <script>
            const vscode = acquireVsCodeApi();
            let base64Attachment = null;
            let attachmentName = null;
            let currentStreamDiv = null;

            // Handle Map Generation Click
            document.getElementById('map-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'generateMap' });
            });

            // Handle Hidden File Upload Wrapper
            document.getElementById('upload-trigger').addEventListener('click', () => {
                document.getElementById('file-input').click();
            });

            document.getElementById('file-input').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                attachmentName = file.name;
                const reader = new FileReader();
                
                reader.onload = function(evt) {
                    base64Attachment = evt.target.result; 
                    document.getElementById('file-preview').innerText = '📎 Attached: ' + file.name;
                };
                
                if (file.type.startsWith('image/')) {
                    reader.readAsDataURL(file); 
                } else {
                    reader.readAsText(file); 
                }
            });

            // Handle Stop Button Click
            document.getElementById('stop-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'stopGeneration' });
                resetUIState();
                
                if (currentStreamDiv) {
                    const contentSpan = currentStreamDiv.querySelector('.stream-content');
                    contentSpan.innerHTML += ' <i style="color: var(--vscode-descriptionForeground);">(Generation stopped)</i>';
                }
            });

            function resetUIState() {
                document.getElementById('send-btn').style.display = 'block';
                document.getElementById('stop-btn').style.display = 'none';
            }

            // Send Prompt Pipeline
            document.getElementById('send-btn').addEventListener('click', () => {
                const text = document.getElementById('user-input').value.trim();
                const provider = document.getElementById('provider').value;
                if (!text && !base64Attachment) return;

                const chatLog = document.getElementById('chat-log');
                chatLog.innerHTML += '<div class="msg user-msg"><b>You:</b> ' + text + (attachmentName ? '<br><small>📎 ' + attachmentName + '</small>' : '') + '</div>';
                chatLog.scrollTop = chatLog.scrollHeight;

                vscode.postMessage({
                    command: 'sendMessage',
                    text: text,
                    provider: provider,
                    attachment: base64Attachment,
                    attachmentType: document.getElementById('file-input').files[0]?.type || null
                });

                document.getElementById('user-input').value = '';
                document.getElementById('file-input').value = '';
                document.getElementById('file-preview').innerText = 'No file attached';
                base64Attachment = null;
                attachmentName = null;
            });

            // Stream Receiver Event Listener Loop
            window.addEventListener('message', event => {
                const message = event.data;
                const chatLog = document.getElementById('chat-log');

                switch (message.command) {
                    case 'startStream':
                        // Show Stop Button, Hide Send Button
                        document.getElementById('send-btn').style.display = 'none';
                        document.getElementById('stop-btn').style.display = 'block';

                        currentStreamDiv = document.createElement('div');
                        currentStreamDiv.className = 'msg ai-msg';
                        currentStreamDiv.innerHTML = '<b>AI (' + message.provider + '):</b> <span class="stream-content"></span>';
                        chatLog.appendChild(currentStreamDiv);
                        chatLog.scrollTop = chatLog.scrollHeight;
                        break;

                    case 'appendStream':
                        if (currentStreamDiv) {
                            const contentSpan = currentStreamDiv.querySelector('.stream-content');
                            contentSpan.textContent += message.text;
                            chatLog.scrollTop = chatLog.scrollHeight;
                        }
                        break;

                    case 'endStream':
                        // Reset button states back to normal when done
                        resetUIState();
                        break;

                    case 'showError':
                        resetUIState();
                        chatLog.innerHTML += '<div class="msg ai-msg" style="color: var(--vscode-errorForeground);">❌ ' + message.text + '</div>';
                        chatLog.scrollTop = chatLog.scrollHeight;
                        break;
                        
                    case 'receiveResponse':
                        resetUIState();
                        chatLog.innerHTML += '<div class="msg ai-msg"><b>AI:</b> ' + message.text + '</div>';
                        chatLog.scrollTop = chatLog.scrollHeight;
                        break;
                }
            });
        </script>
    </body>
    </html>`;
}
