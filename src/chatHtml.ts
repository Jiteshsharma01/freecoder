export function getChatHtml(webviewUri: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: sans-serif; padding: 10px; display: flex; flex-direction: column; height: 100vh; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); box-sizing: border-box; margin: 0; position: relative; }
            select, button, textarea { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-dropdown-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); box-sizing: border-box; }
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
            .submit-box { display: flex; gap: 5px; justify-content: flex-end; margin-top: 6px; }
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
            <div id="select-ai">
                <label for="provider">AI Provider Tool:</label>
                <select id="provider">
                    <option value="ollama-qwen3-local">Local Ollama (Qwen3-Coder:30b)</option>
                    <option value="gemini">Gemini Flash (Free Tier)</option>
                    <option value="huggingface">Hugging Face API</option>
                </select>
            </div>
            <div style="display: flex; gap: 6px; align-items: end;">
                <button id="map-btn" class="btn-with-icon">🗺️ Map</button>
                <button id="graph-btn" class="btn-with-icon">🕸️ Graph</button>
            </div>
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
            <button id="agent-btn">Agent ✏️</button>
            <button id="clear-btn" class="btn-danger" style="width: auto; padding: 0 12px; margin: 0; white-space: nowrap;">🗑️ Clear</button>
        </div>

        <script>
            console.log('FreeCopilot WebView loaded');
            const vscode = acquireVsCodeApi();
            let base64Attachment = null;
            let attachmentName = null;
            let currentStreamDiv = null;
            let currentResponseText = "";
            const DEFAULT_HEIGHT = '50px';
            let apiLoadingIndicator = null;
            let agentProgressDiv = null;
            let agentPlanDiv = null;
            let agentReviewDiv = null;
            let normalChatBusy = false;

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
            document.getElementById('graph-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'generateKnowledgeGraph' });
            });

            // Handle Clear chat click
            document.getElementById('clear-btn').addEventListener('click', () => {
                // Check if the chat log contains elements before asking to prevent empty click triggers
                const chatLogEl = document.getElementById('chat-log');
                if (!chatLogEl || chatLogEl.innerHTML.trim() === '') {
                    return; // Skip asking if there is nothing to clear anyway
                }
                // Ask backend extension layer to prompt the developer natively
                vscode.postMessage({ command: 'requestClearConfirmation' });
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
                normalChatBusy = false;
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
                normalChatBusy = false;
                // Clean up any loose embedded loader nodes
                const activeLoader = document.getElementById('ai-embedded-loader');
                if (activeLoader) activeLoader.remove();
            }
            
            function showAgentStatus(text) {
                const chatLog = document.getElementById('chat-log');
                if (!chatLog) { return; }
                const status = document.createElement('div');
                status.className = 'msg ai-msg';
                status.style.fontSize = '12px';
                status.style.opacity = '0.85';
                status.innerText = text;
                chatLog.appendChild(status);
                scrollToBottom();
            }
            
            function renderApplyButton() {
                var chatLog =
                    document.getElementById(
                        'chat-log'
                    );

                if (!chatLog) {
                    return;
                }

                if (agentReviewDiv) {
                    agentReviewDiv.remove();
                }

                agentReviewDiv =
                    document.createElement(
                        'div'
                    );

                agentReviewDiv.className =
                    'msg ai-msg';

                agentReviewDiv.innerHTML =
                    '<div style="font-weight: 600;">' +
                        '🔍 Review Changes' +
                    '</div>' +

                    '<div style="' +
                        'margin-top: 6px;' +
                        'font-size: 11px;' +
                        'opacity: 0.8;' +
                    '">' +
                        'The proposed changes are open in ' +
                        'the VS Code diff editor.' +
                    '</div>' +

                    '<div style="' +
                        'display: flex;' +
                        'gap: 6px;' +
                        'margin-top: 10px;' +
                    '">' +

                        '<button ' +
                            'id="apply-agent-changes" ' +
                            'style="width: auto;"' +
                        '>' +
                            'Apply All Changes' +
                        '</button>' +

                        '<button ' +
                            'id="cancel-agent-changes" ' +
                            'style="width: auto;"' +
                        '>' +
                            'Cancel' +
                        '</button>' +

                    '</div>';

                chatLog.appendChild(
                    agentReviewDiv
                );

                var applyButton =
                    agentReviewDiv.querySelector(
                        '#apply-agent-changes'
                    );

                var cancelButton =
                    agentReviewDiv.querySelector(
                        '#cancel-agent-changes'
                    );

                if (applyButton) {
                    applyButton.addEventListener(
                        'click',
                        function() {

                            applyButton.disabled =
                                true;

                            applyButton.innerText =
                                'Applying...';

                            if (cancelButton) {
                                cancelButton.disabled =
                                    true;
                            }

                            vscode.postMessage({
                                command:
                                    'applyAgentTask'
                            });
                        }
                    );
                }

                if (cancelButton) {
                    cancelButton.addEventListener(
                        'click',
                        function() {

                            vscode.postMessage({
                                command:
                                    'cancelAgentTask'
                            });

                            if (agentReviewDiv) {
                                agentReviewDiv.remove();
                                agentReviewDiv = null;
                            }

                            removeAgentProgress();
                        }
                    );
                }

                scrollToBottom();
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

            document.getElementById('agent-btn').addEventListener('click', () => {
                if (normalChatBusy) {
                    showAgentStatus('⚠️ Stop the current AI generation before starting an Agent task.');
                    return;
                }
                var userInputEl = document.getElementById('user-input');
                var text = userInputEl.value.trim();
                if (!text) { return; }
                var chatLog = document.getElementById('chat-log');
                var safeEscape = function(value) {
                    return String(value || '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                };
                chatLog.innerHTML +=
                    '<div class="msg user-msg">' +
                        '<b style="font-size: 13px;">You → Agent:</b>' +
                        '<div class="user-content" style="white-space: pre-wrap; margin-top: 4px;">' +
                            safeEscape(text) +
                        '</div>' +
                    '</div>';
                scrollToBottom();
                createAgentProgress();
                updateAgentProgress('planning', 'Understanding your request...');
                vscode.postMessage({command: 'agentRequest', message: text});
                userInputEl.value = '';
                userInputEl.style.height = DEFAULT_HEIGHT;
            });

            // Send Prompt Pipeline
            document.getElementById('send-btn').addEventListener('click', () => {
                const userInputEl = document.getElementById('user-input');
                const text = userInputEl.value.trim();
                const provider = document.getElementById('provider').value;
                if (!text && !base64Attachment) return;

                normalChatBusy = true;
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

            function renderAgentPlan(plan) {
                var chatLog = document.getElementById('chat-log');
                if (!chatLog) { return; }

                /*
                * Remove any previous Agent Plan card before creating a new one.
                */
                if (agentPlanDiv) {
                    agentPlanDiv.remove();
                    agentPlanDiv = null;
                }

                var safeEscape = function(value) {
                    return String(value || '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                };

                /*
                * Build the file-change summary.
                */
                var changesHtml = '';

                if (
                    Array.isArray(plan.changes) &&
                    plan.changes.length > 0
                ) {
                    plan.changes.forEach(function(change) {
                        var operationLabel = safeEscape(change.operation || 'modify');
                        var explanation = safeEscape(change.explanation || 'No explanation provided.');
                        var pathDisplay = change.operation === 'rename'
                            ? (safeEscape(change.originalPath || change.path) +
                                ' → ' +
                                safeEscape(change.newPath || change.path)
                            )
                            : safeEscape(change.path);
                        changesHtml +=
                            '<div style="' +
                                'padding: 8px;' +
                                'margin-bottom: 6px;' +
                                'border: 1px solid var(--vscode-panel-border);' +
                                'border-radius: 4px;' +
                                'background: var(--vscode-textCodeBlock-background);' +
                            '">' +

                                '<div style="' +
                                    'font-weight: 600;' +
                                    'word-break: break-word;' +
                                '">' +
                                    pathDisplay +
                                '</div>' +

                                '<div style="' +
                                    'font-size: 11px;' +
                                    'margin-top: 4px;' +
                                    'opacity: 0.8;' +
                                '">' +
                                    operationLabel +
                                    ' — ' +
                                    explanation +
                                '</div>' +

                            '</div>';
                    });
                } else {
                    changesHtml =
                        '<div style="' +
                            'font-size: 11px;' +
                            'opacity: 0.7;' +
                        '">' +
                            'No individual file changes were listed in the plan.' +
                        '</div>';
                }

                /*
                * Create Agent Plan card.
                */
                agentPlanDiv = document.createElement('div');
                agentPlanDiv.className = 'msg ai-msg';
                agentPlanDiv.id = 'agent-plan-card';
                agentPlanDiv.innerHTML =
                    '<div style="' +
                        'font-weight: 600;' +
                        'font-size: 13px;' +
                    '">' +
                        '🧠 Agent Plan' +
                    '</div>' +

                    '<div style="' +
                        'margin-top: 7px;' +
                        'font-size: 12px;' +
                        'line-height: 1.5;' +
                    '">' +
                        safeEscape(
                            plan.summary ||
                            'No summary provided.'
                        ) +
                    '</div>' +

                    '<div style="' +
                        'margin-top: 7px;' +
                        'font-size: 11px;' +
                        'line-height: 1.5;' +
                        'opacity: 0.8;' +
                    '">' +
                        safeEscape(
                            plan.reasoning ||
                            ''
                        ) +
                    '</div>' +

                    '<div style="' +
                        'margin-top: 10px;' +
                    '">' +
                        changesHtml +
                    '</div>' +

                    '<div style="' +
                        'display: flex;' +
                        'gap: 6px;' +
                        'margin-top: 10px;' +
                        'align-items: center;' +
                    '">' +

                        '<button ' +
                            'id="generate-agent-changes-btn" ' +
                            'style="' +
                                'width: auto;' +
                                'transition: opacity 0.15s ease;' +
                            '"' +
                        '>' +
                            'Generate Changes' +
                        '</button>' +

                        '<button ' +
                            'id="cancel-agent-plan-btn" ' +
                            'style="' +
                                'width: auto;' +
                            '"' +
                        '>' +
                            'Cancel' +
                        '</button>' +

                    '</div>';

                chatLog.appendChild(agentPlanDiv);

                /*
                * Get buttons after the card has been added to the DOM.
                */
                var generateButton = agentPlanDiv.querySelector('#generate-agent-changes-btn');
                var cancelButton = agentPlanDiv.querySelector('#cancel-agent-plan-btn');

                if (generateButton) {
                    generateButton.addEventListener('click', function() {
                        generateButton.disabled = true;
                        generateButton.innerText = 'Generating...';
                        generateButton.style.opacity = '0.6';
                        generateButton.style.cursor = 'not-allowed';

                        /*
                        * Cancel is also disabled because
                        * the generation operation has now started.
                        *
                        * The user should use "Stop Agent"
                        * from the Agent progress card instead.
                        */
                        if (cancelButton) {
                            cancelButton.disabled = true;
                            cancelButton.style.opacity = '0.5';
                            cancelButton.style.cursor = 'not-allowed';
                            cancelButton.innerText = 'Cancel';
                        }

                        /*
                        * Notify the extension host.
                        */
                        vscode.postMessage({command: 'generateAgentChanges'});
                    });
                }

                /*
                * Cancel Plan
                *
                * This is available only while the
                * plan is waiting for approval.
                */
                if (cancelButton) {
                    cancelButton.addEventListener('click', function() {
                        /*
                        * Prevent repeated cancellation clicks.
                        */
                        cancelButton.disabled = true;
                        cancelButton.style.opacity = '0.5';
                        cancelButton.style.cursor = 'not-allowed';

                        /*
                        * Tell extension host to cancel
                        * the current Agent task.
                        */
                        vscode.postMessage({command: 'cancelAgentTask'});

                        /*
                        * Remove the plan immediately
                        * from the WebView.
                        */
                        if (agentPlanDiv) {
                            agentPlanDiv.remove();
                            agentPlanDiv = null;
                        }
                        /*
                        * Remove Agent progress.
                        */
                        removeAgentProgress();
                    });
                }
                scrollToBottom();
            }

            var AGENT_STAGES = [
                {
                    id: 'planning',
                    label: 'Understanding request'
                },
                {
                    id: 'context',
                    label: 'Reviewing current file and related files'
                },
                {
                    id: 'plan',
                    label: 'Creating agent plan'
                },
                {
                    id: 'planApproval',
                    label: 'Waiting for plan approval'
                },
                {
                    id: 'changes',
                    label: 'Generating file changes'
                },
                {
                    id: 'diff',
                    label: 'Opening VS Code diff'
                },
                {
                    id: 'diffApproval',
                    label: 'Waiting for diff approval'
                },
                {
                    id: 'applying',
                    label: 'Applying changes'
                },
                {
                    id: 'completed',
                    label: 'Changes applied'
                }
            ];

            function createAgentProgress() {
                var chatLog =
                    document.getElementById(
                        'chat-log'
                    );

                if (!chatLog) {
                    return;
                }

                if (agentProgressDiv) {
                    agentProgressDiv.remove();
                    agentProgressDiv = null;
                }

                agentProgressDiv =
                    document.createElement(
                        'div'
                    );

                agentProgressDiv.className =
                    'msg ai-msg';

                agentProgressDiv.id =
                    'agent-progress';

                /*
                * IMPORTANT:
                * Every string here is explicitly joined with +.
                * There are no accidental adjacent string literals.
                */
                agentProgressDiv.innerHTML =
                    '<div style="font-weight: 600;">' +
                        '🧠 FreeCopilot Agent' +
                    '</div>' +

                    '<div ' +
                        'id="agent-progress-list" ' +
                        'style="' +
                            'margin-top: 8px;' +
                            'font-size: 12px;' +
                            'line-height: 1.8;' +
                        '"' +
                    '></div>' +

                    '<div ' +
                        'id="agent-progress-status" ' +
                        'style="' +
                            'margin-top: 6px;' +
                            'font-size: 11px;' +
                            'opacity: 0.7;' +
                        '"' +
                    '></div>' +

                    '<div style="margin-top: 8px;">' +
                        '<button ' +
                            'id="agent-stop-btn" ' +
                            'style="' +
                                'display: none;' +
                                'width: auto;' +
                            '"' +
                        '>' +
                            'Stop Agent ⏹️' +
                        '</button>' +
                    '</div>';

                chatLog.appendChild(
                    agentProgressDiv
                );

                /*
                * IMPORTANT:
                * The stop button is queried only AFTER
                * agentProgressDiv has been created and added.
                */
                var stopButton =
                    agentProgressDiv.querySelector(
                        '#agent-stop-btn'
                    );

                if (stopButton) {
                    stopButton.addEventListener(
                        'click',
                        function() {

                            stopButton.disabled =
                                true;

                            stopButton.innerText =
                                'Stopping...';

                            vscode.postMessage({
                                command:
                                    'stopAgent'
                            });
                        }
                    );
                }

                renderAgentProgress(
                    'planning',
                    false
                );

                scrollToBottom();
            }

            function renderAgentProgress(
                activeStage,
                completed
            ) {
                if (!agentProgressDiv) {
                    createAgentProgress();
                }

                if (!agentProgressDiv) {
                    return;
                }

                var container =
                    agentProgressDiv.querySelector(
                        '#agent-progress-list'
                    );

                if (!container) {
                    return;
                }

                var activeIndex =
                    AGENT_STAGES.findIndex(
                        function(stage) {
                            return stage.id === activeStage;
                        }
                    );

                var html = '';

                AGENT_STAGES.forEach(
                    function(stage, index) {

                        var icon = '○';
                        var opacity = '0.45';

                        if (completed) {
                            icon = '✓';
                            opacity = '1';

                        } else if (
                            index < activeIndex
                        ) {
                            icon = '✓';
                            opacity = '1';

                        } else if (
                            index === activeIndex
                        ) {
                            icon = '●';
                            opacity = '1';
                        }

                        /*
                        * Before completion, the completed stage
                        * remains an empty circle.
                        */
                        if (
                            stage.id === 'completed' &&
                            !completed
                        ) {
                            icon = '○';
                            opacity = '0.45';
                        }

                        html +=
                            '<div style="' +
                                'display:flex;' +
                                'align-items:center;' +
                                'gap:7px;' +
                                'opacity:' +
                                opacity +
                                ';' +
                            '">' +

                                '<span>' +
                                    icon +
                                '</span>' +

                                '<span>' +
                                    stage.label +
                                '</span>' +

                            '</div>';
                    }
                );

                container.innerHTML =
                    html;

                scrollToBottom();
            }

            function updateAgentProgress(
                stage,
                text
            ) {
                if (!agentProgressDiv) {
                    createAgentProgress();
                }

                if (!agentProgressDiv) {
                    return;
                }

                renderAgentProgress(
                    stage,
                    false
                );

                var status =
                    agentProgressDiv.querySelector(
                        '#agent-progress-status'
                    );

                if (status) {
                    status.textContent =
                        text || '';
                }

                /*
                * Stop Agent is available only while
                * an AI operation is running.
                */
                setAgentStopButtonVisible(
                    stage === 'planning' ||
                    stage === 'context' ||
                    stage === 'plan' ||
                    stage === 'changes'
                );
            }

            function setAgentStopButtonVisible(
                visible
            ) {
                if (!agentProgressDiv) {
                    return;
                }

                var button =
                    agentProgressDiv.querySelector(
                        '#agent-stop-btn'
                    );

                if (!button) {
                    return;
                }

                button.style.display =
                    visible
                        ? 'inline-block'
                        : 'none';

                if (visible) {
                    button.disabled =
                        false;

                    button.innerText =
                        'Stop Agent ⏹️';

                    button.style.opacity =
                        '1';

                    button.style.cursor =
                        'pointer';
                }
            }

            function completeAgentProgress(
                text
            ) {
                if (!agentProgressDiv) {
                    return;
                }

                renderAgentProgress(
                    'completed',
                    true
                );

                var status =
                    agentProgressDiv.querySelector(
                        '#agent-progress-status'
                    );

                if (status) {
                    status.textContent =
                        text ||
                        'All changes were applied successfully.';
                }

                setAgentStopButtonVisible(
                    false
                );

                scrollToBottom();
            }

            function removeAgentProgress() {
                if (agentProgressDiv) {
                    agentProgressDiv.remove();
                    agentProgressDiv = null;
                }

                agentPlanDiv = null;
                agentReviewDiv = null;
            }

            function setAgentButtonBusy(busy) {
                var agentButton = document.getElementById('agent-btn');
                var sendButton = document.getElementById('send-btn');
                if (agentButton) {
                    agentButton.disabled = busy;
                    agentButton.style.opacity = busy ? '0.5' : '1';
                    agentButton.style.cursor = busy ? 'not-allowed' : 'pointer';
                }
                if (sendButton) {
                    sendButton.disabled = busy || normalChatBusy;
                    sendButton.style.opacity = (busy ||normalChatBusy) ? '0.5' : '1';
                    sendButton.style.cursor = (busy ||normalChatBusy) ? 'not-allowed' : 'pointer';
                }
            }

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
                    case 'executeConfirmedClear':
                        // 1. Instantly send the stop command to kill any running background networks
                        vscode.postMessage({ command: 'stopGeneration' });

                        // 2. Clear out panels and reset streaming variables
                        if (chatLog) chatLog.innerHTML = '';
                        currentStreamDiv = null;
                        currentResponseText = "";
                        
                        // 3. Reset inputs and unlock controls
                        if (typeof resetUIState === 'function') {
                            resetUIState();
                        }
                        
                        // 4. Update the saved layout state history memory configuration
                        if (typeof saveStateState === 'function') {
                            saveStateState();
                        }
                        break;
                    
                    case "agentProgress":
                        setAgentButtonBusy(true);
                        updateAgentProgress(message.stage, message.text);
                        break;

                    case 'agentPlan':
                        updateAgentProgress('planApproval', 'Review the proposed plan.');
                        renderAgentPlan(message.plan);
                        break;

                    case 'agentExecutionStarted':
                        updateAgentProgress('changes', 'Generating the actual file changes...');
                        break;

                    case 'agentDiffReady':
                        updateAgentProgress('diff', 'Opening the proposed changes in VS Code...');
                        break;

                    case 'agentAwaitingApply':
                        updateAgentProgress('diffApproval', 'Review the diff before applying changes.');
                        renderApplyButton();
                        break;
                    case "agentBusy":
                        setAgentButtonBusy(true);
                        showAgentStatus("⚠️ " + message.text);
                        break;
                    case 'agentApplyingChanges':
                        updateAgentProgress('applying', 'Applying approved changes...');
                        break;
                    case "agentPlanAccepted":
                        if (agentPlanDiv) {
                            agentPlanDiv.remove();
                            agentPlanDiv = null;
                        }
                        break;

                    case 'agentExecutionCompleted':
                        setAgentButtonBusy(false);
                        if (agentPlanDiv) {
                            agentPlanDiv.remove();
                            agentPlanDiv = null;
                        }
                        if (agentReviewDiv) {
                            agentReviewDiv.remove();
                            agentReviewDiv = null;
                        }
                        completeAgentProgress('All approved changes were applied successfully.');
                        break;

                    case 'agentExecutionCancelled':
                        setAgentButtonBusy(false);
                        if (agentPlanDiv) {
                            agentPlanDiv.remove();
                            agentPlanDiv = null;
                        }
                        if (agentReviewDiv) {
                            agentReviewDiv.remove();
                            agentReviewDiv = null;
                        }
                        removeAgentProgress();
                        break;

                    case 'agentExecutionFailed':
                        setAgentButtonBusy(false);
                        showAgentStatus('❌ ' + message.text);
                        break;

                    case 'endStream':
                        normalChatBusy = false;
                        resetUIState();
                        break;

                    case 'showError':
                        normalChatBusy = false;
                        resetUIState();
                        chatLog.innerHTML += '<div style="color: var(--vscode-errorForeground);">❌ ' + message.text + '</div>';
                        if (!isUserScrolledUp) scrollToBottom();
                        break;
                        
                    case 'receiveResponse':
                        normalChatBusy = false;
                        resetUIState();
                        chatLog.innerHTML += '<div><b>AI:</b> ' + formatMarkdownStream(message.text) + '</div>';
                        attachAllCopyListeners();
                        if (!isUserScrolledUp) scrollToBottom();
                        break;
                }
            });

            console.log('FreeCopilot WebView initialization complete');
        </script>
    </body>
    </html>`;
}
