export function getChatHtml(webviewUri: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: sans-serif; padding: 10px; display: flex; flex-direction: column; height: 100vh; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); box-sizing: border-box; margin: 0; position: relative; }
            select, button, textarea { width: 100%; margin-bottom: 8px; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-dropdown-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); box-sizing: border-box; }
            button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; width: fit-content; }
            button:hover { background: var(--vscode-button-hoverBackground); }
            #selection-box { display: flex; gap: 10px; }
            // #select-ai { display: flex; gap: 10px; }
            .btn-with-icon { display: flex; align-items: center; justify-content: center; gap: 8px; }
            /* Container positioning relative for arrow layout overlays */
            #chat-container { flex-grow: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; margin-bottom: 8px; }
            #chat-log { flex-grow: 1; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 8px; border-radius: 4px; background: var(--vscode-editor-background); font-size: 13px; }
            .msg { margin-bottom: 10px; padding: 6px; border-radius: 4px; }
            .user-msg { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); max-height: 150px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 11px; }
            .ai-msg { background: var(--vscode-textCodeBlock-background); }
            textarea { resize: none; min-height: 50px; max-height: 120px; overflow-y: auto; box-sizing: border-box; font-size: 12px; }
            .submit-box { display: flex; gap: 5px; justify-content: flex-end; }
            #file-preview { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
            .user-content { white-space: pre-wrap; font-family: monospace; }
            .stream-content { white-space: pre-wrap; font-family: monospace; }
            .code-block-wrapper { position: relative; background: #1e1e1e; border-radius: 4px; margin: 8px 0; padding: 28px 8px 8px 8px; }
            .code-container-scroll { max-height: 70px; overflow-y: auto; overflow-x: auto; }
            .copy-btn { position: absolute; top: 4px; right: 4px; width: auto; padding: 2px 6px; font-size: 10px; background: rgba(255,255,255,0.1); color: #fff; z-index: 5; }
            .copy-btn:hover { background: rgba(255,255,255,0.2); }
            pre { margin: 0; font-family: monospace; color: #d4d4d4; font-size: 12px; }
            /* Styled stop button */
            #stop-btn { background: var(--vscode-statusBarItem-errorBackground, #c74242); color: white; display: none; }
            #stop-btn:hover { background: #b03535; }
            /* NEW: Floating Scroll Anchor Arrow */
            #scroll-anchor { position: absolute; bottom: 15px; right: 20px; width: 32px; height: 32px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); z-index: 99; transition: opacity 0.2s ease, transform 0.2s ease; opacity: 0; pointer-events: none; transform: translateY(5px); }
            #scroll-anchor.visible { opacity: 0.9; pointer-events: auto; transform: translateY(0); }
            #scroll-anchor:hover { background: var(--vscode-button-hoverBackground); opacity: 1; }

            /* Animated Loading Spinner Element */
            .api-loading-dots { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; margin-top: 5px; font-size: 12px; color: var(--vscode-descriptionForeground); }
            .loading-dot { width: 6px; height: 6px; background-color: var(--vscode-descriptionForeground); border-radius: 50%; animation: bounceDot 1.4s infinite ease-in-out both; }
            .loading-dot:nth-child(1) { animation-delay: -0.32s; }
            .loading-dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes bounceDot { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }

            * { scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
            /* 2. Webkit-specific customization to perfectly style scrollbars across platforms */
            #chat-log::-webkit-scrollbar, .code-container-scroll::-webkit-scrollbar, textarea::-webkit-scrollbar { width: 6px; height: 6px; }

            /* Style the moving scrollbar handle using native VS Code theme colors */
            #chat-log::-webkit-scrollbar-thumb, .code-container-scroll::-webkit-scrollbar-thumb, textarea::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); border-radius: 10px; }

            /* Brighten the scrollbar handle slightly when hovered */
            #chat-log::-webkit-scrollbar-thumb:hover, .code-container-scroll::-webkit-scrollbar-thumb:hover, textarea::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }

            /* Keep the background track transparent so it looks completely seamless */
            #chat-log::-webkit-scrollbar-track, .code-container-scroll::-webkit-scrollbar-track, textarea::-webkit-scrollbar-track { background: transparent; }
        </style>
    </head>
    <body>
        <div id="selection-box">
            <!-- 1. Model Selection -->
            <div id="select-ai">
                <label for="provider">AI Provider Tool:</label>
                <select id="provider">
                    <option value="ollama-qwen3-local">Local Ollama (Qwen3-Coder:30b)</option>
                    <option value="gemini-cloud">Gemini 1.5 Flash (Cloud - Supports Images & Files)</option>
                    <option value="huggingface-cloud">Hugging Face API (Cloud - Text Only)</option>
                </select>
            </div>
            <!-- 2. Project Map Trigger Button -->
            <button id="map-btn">Generate 🛠️🗺️</button>
        </div>

        <!-- Wrapped log panel inside structural relative frame block -->
        <div id="chat-container">
            <div id="chat-log"></div>
            <!-- FLOATING ANCHOR BUTTON -->
            <div id="scroll-anchor" title="Scroll to bottom">👇</div>
        </div>

        <!-- Attachment UI Display Area -->
        <div id="file-preview">No file attached</div>

        <!-- 4. Input Controls -->
        <textarea id="user-input" placeholder="Ask a question or request code..."></textarea>
        <div class="submit-box">
            <button id="upload-trigger" style="width: 40px;">📎</button>
            <input type="file" id="file-input" style="display: none;" accept="image/*,.txt,.md,.json,.js,.ts" />
            <button id="send-btn">Generate 🚀</button>
            <button id="stop-btn">Stop AI ⏹️</button>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let base64Attachment = null;
            let attachmentName = null;
            let currentStreamDiv = null;
            let currentResponseText = "";
            const DEFAULT_HEIGHT = '50px';
            let apiLoadingIndicator = null;

            // Track scrolling state explicitly
            let isUserScrolledUp = false; 
            const chatLog = document.getElementById('chat-log');
            const scrollAnchor = document.getElementById('scroll-anchor');

            // Check if element window is locked close to bottom limit boundary margin
            function isScrolledToBottom() {
                const threshold = 40; // Pixel padding allowance margin
                return (chatLog.scrollHeight - chatLog.clientHeight - chatLog.scrollTop) <= threshold;
            }

            function scrollToBottom() {
                chatLog.scrollTop = chatLog.scrollHeight;
                isUserScrolledUp = false;
                if (scrollAnchor) scrollAnchor.classList.remove('visible');
            }

            // Monitor Scroll Changes to handle Manual Top movements vs Bottom landings
            chatLog.addEventListener('scroll', () => {
                if (isScrolledToBottom()) {
                    isUserScrolledUp = false;
                    if (scrollAnchor) scrollAnchor.classList.remove('visible');
                } else {
                    isUserScrolledUp = true;
                    if (scrollAnchor) scrollAnchor.classList.add('visible');
                }
            });

            // Handle Anchor Arrow click interactions 
            if (scrollAnchor) scrollAnchor.addEventListener('click', scrollToBottom);

            // NEW: Isolated Markdown Markdown Stream Formatter with a strict 70px height limit
            function formatMarkdownStream(rawText) {
                // 1. Sanitize raw HTML tags to prevent cross-site execution breaks
                var formatted = rawText
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                // 2. Uses hexadecimal character matching (\\x60 for backticks) to bypass string termination bugs
                var regex = new RegExp('\\x60\\x60\\x60(\\x5cw*)\\x0a([\\x5cs\\x5cS]*?)\\x60\\x60\\x60', 'g');

                formatted = formatted.replace(regex, function(match, lang, code) {
                    return '<div class="code-block-wrapper">' +
                        '<button class="copy-btn">Copy</button>' +
                        '<div class="code-container-scroll" style="max-height: 120px; overflow-y: auto; overflow-x: auto;">' +
                            '<pre style="margin: 0; font-family: monospace; color: #d4d4d4; font-size: 12px;"><code>' + code.trim() + '</code></pre>' +
                        '</div>' +
                    '</div>';
                });

                return formatted;
            }

            // NEW: Clipboard Copy Hook binder supporting nested layout elements
            function attachAllCopyListeners() {
                document.querySelectorAll('.copy-btn').forEach(btn => {
                    if (btn.hasAttribute('data-hooked')) return;
                    btn.setAttribute('data-hooked', 'true');
                    btn.addEventListener('click', () => {
                        const targetBox = btn.parentElement.querySelector('.code-container-scroll code');
                        if (targetBox) {
                            navigator.clipboard.writeText(targetBox.innerText);
                            const originalText = btn.innerText;
                            btn.innerText = 'Copied!';
                            setTimeout(() => btn.innerText = originalText, 1500);
                        }
                    });
                });
            }

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
                document.getElementById('user-input').disabled = false;
                document.getElementById('provider').disabled = false;
                // Clean up any loose embedded loader nodes
                const activeLoader = document.getElementById('ai-embedded-loader');
                if (activeLoader) activeLoader.remove();
            }

            const textarea = document.getElementById('user-input');
            textarea.addEventListener('input', function () {
                // If the user cleared the text, reset to default instantly
                if (this.value.trim() === '') {
                    this.style.height = DEFAULT_HEIGHT;
                    return;
                }
                // Otherwise, handle dynamic growing up to your CSS max-height
                this.style.height = 'auto';
                this.style.height = this.scrollHeight + 'px';
            });

            // Send Prompt Pipeline
            document.getElementById('send-btn').addEventListener('click', () => {
                const userInputEl = document.getElementById('user-input');
                const text = userInputEl.value.trim();
                const provider = document.getElementById('provider').value;
                if (!text && !base64Attachment) return;

                // Lock out alternative input configurations while streaming is active
                document.getElementById('send-btn').style.display = 'none';
                document.getElementById('stop-btn').style.display = 'block';
                userInputEl.disabled = true;
                document.getElementById('provider').disabled = true;

                const safeEscape = (str) => {
                    return str
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "'");
                };

                const chatLog = document.getElementById('chat-log');
                const safeText = safeEscape(text);
                
                chatLog.innerHTML += 
                    '<div class="msg user-msg">' +
                        '<b style="font-size: 13px;">You:</b>' +
                        '<div class="user-content" style="white-space: pre-wrap; margin-top: 4px;">' + safeText + '</div>' +
                        (attachmentName ? '<div class="user-attachment" style="margin-top: 6px; font-size: 11px; opacity: 0.8;"><small>📎 ' + attachmentName + '</small></div>' : '') +
                    '</div>';
                
                scrollToBottom();

                // Send the ORIGINAL text to your extension host
                vscode.postMessage({
                    command: 'sendMessage',
                    text: text, 
                    provider: provider,
                    attachment: base64Attachment,
                    attachmentType: document.getElementById('file-input').files[0]?.type || null
                });

                // Clear controls safely
                userInputEl.value = '';
                userInputEl.style.height = 'auto'; 
                userInputEl.style.setProperty('height', DEFAULT_HEIGHT, 'important');
                document.getElementById('file-input').value = '';
                document.getElementById('file-preview').innerText = 'No file attached';
                base64Attachment = null;
                attachmentName = null;
            });

            // Stream Receiver Event Listener Loop
            window.addEventListener('message', event => {
                const message = event.data;

                switch (message.command) {
                    case 'startStream':
                        // Show Stop Button, Hide Send Button
                        document.getElementById('send-btn').style.display = 'none';
                        document.getElementById('stop-btn').style.display = 'block';
                        currentResponseText = ""; // Clear buffer for new chunk cycles
                        currentStreamDiv = document.createElement('div');
                        currentStreamDiv.className = 'msg ai-msg';
                        currentStreamDiv.innerHTML = '<b>AI (' + message.provider + '):</b>' +
                            '<div id="ai-embedded-loader" class="api-loading-dots" style="display: inline-flex; margin-left: 8px; margin-top: 0; padding: 2px 6px; font-size: 11px;">' +
                                '<span>thinking</span>' +
                                '<div class="loading-dot" style="width: 4px; height: 4px;"></div>' +
                                '<div class="loading-dot" style="width: 4px; height: 4px;"></div>' +
                                '<div class="loading-dot" style="width: 4px; height: 4px;"></div>' +
                            '</div>' +
                            '<div class="stream-content"></div>';
                        
                        chatLog.appendChild(currentStreamDiv);
                        scrollToBottom();
                        break;

                    case 'appendStream':
                        if (currentStreamDiv) {
                            // DESTROY EMBEDDED DOTS: The exact millisecond the first true token character arrives, remove the loader
                            const embeddedLoader = currentStreamDiv.querySelector('#ai-embedded-loader');
                            if (embeddedLoader) {
                                embeddedLoader.remove();
                            }
                            currentResponseText += message.text;
                            const contentSpan = currentStreamDiv.querySelector('.stream-content');
                            // Re-evaluate markdown and parse into a 70px scroll container
                            contentSpan.innerHTML = formatMarkdownStream(currentResponseText);
                            attachAllCopyListeners();

                            // Smart scroll focus follow check
                            if (!isUserScrolledUp) { chatLog.scrollTop = chatLog.scrollHeight; }
                        }
                        break;

                    case 'endStream':
                        resetUIState();
                        break;

                    case 'showError':
                        resetUIState();
                        chatLog.innerHTML += '<div style="color: var(--vscode-errorForeground);">❌ ' + message.text + '</div>';
                        if (!isUserScrolledUp) scrollToBottom();
                        break;
                        
                    case 'receiveResponse':
                        resetUIState();
                        chatLog.innerHTML += '<div><b>AI:</b> ' + formatMarkdownStream(message.text) + '</div>';
                        attachAllCopyListeners();
                        if (!isUserScrolledUp) scrollToBottom();
                        break;
                }
            });s
        </script>
    </body>
    </html>`;
}
