export function getChatHtml(webviewUri: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; }
            body { font-family: sans-serif; padding: 10px; display: flex; flex-direction: column; height: 100vh; min-height: 0; overflow: hidden; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); box-sizing: border-box; margin: 0; position: relative; }
            select, button, textarea { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-dropdown-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); box-sizing: border-box; outline: none; }
            button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; width: fit-content; }
            button:hover { background: var(--vscode-button-hoverBackground); }
            #selection-box { display: flex; gap: 10px; }
            .btn-with-icon { display: flex; align-items: center; justify-content: center; gap: 8px; }
            /* Container positioning relative for arrow layout overlays */
            #chat-container { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; margin-bottom: 8px; }
            #chat-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 0px; background: var(--vscode-editor-background); font-size: 13px; }
            .msg { margin-bottom: 10px; padding: 6px; border-radius: 4px; }
            .user-msg { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); max-height: 200px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 12px; }
            .ai-msg { padding: 8px 0; }
            #input-box { border: 1px solid #3b3a3a; border-radius: 8px; overflow: visible; position: relative; flex-shrink: 0; }
            textarea { resize: none; min-height: 70px; max-height: 400px; overflow-y: auto; box-sizing: border-box; display: block; border: none; padding: 8px; background: transparent; }
            #input-box:focus-within { border: 1px solid #565656; }
            #input-mode-row { cursor: pointer; display: flex; flex-direction: row; align-items: center; gap: 8px; width: fit-content; padding: 6px; }
            #input-mode-row select { padding: 3px; font-size: 10px; border-radius: 20px; background: #595858c7; }
            #model-select { width: auto; min-width: 90px; max-width: 150px; padding: 3px 8px; font-size: 10px; border-radius: 20px; background: #595858c7; color: var(--vscode-dropdown-foreground); border: none; cursor: pointer; }

            #input-config-row { position: relative; display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 4px 6px 0; }
            #main-config-btn { margin-left: auto; width: auto; padding: 3px 6px; font-size: 11px; border: none; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
            #main-config-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
            #main-config-menu { position: absolute; right: 0; bottom: calc(100% + 6px); width: 195px; padding: 7px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editorWidget-background); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); z-index: 1000; display: none; }
            #main-config-menu.visible { display: block; }
            .config-menu-header { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 6px; color: var(--vscode-descriptionForeground); font-size: 11px; }
            .config-menu-actions { display: flex; gap: 2px; }
            .config-menu-item { width: 100%; padding: 7px 8px; border-radius: 4px; background: transparent; color: var(--vscode-foreground); border: none; text-align: left; font-size: 11px; }
            .config-menu-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .config-menu-reload { margin-top: 3px; color: var(--vscode-descriptionForeground); }
            .config-menu-reload:hover { background: var(--vscode-list-hoverBackground); }
            .config-menu-shortcut { padding: 6px 8px 2px; color: var(--vscode-descriptionForeground); font-size: 10px; opacity: 0.8; }

            .submit-box { display: flex; gap: 5px; justify-content: flex-end; margin-top: 6px; flex-shrink: 0; }
            #file-preview { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; flex-shrink: 0; }
            .user-content { white-space: pre-wrap; font-family: monospace; }
            .stream-content { white-space: pre-wrap; font-family: monospace; }
            .code-block-wrapper { position: relative; background: var(--vscode-editor-background); margin: 8px 0; padding: 0; overflow: hidden; }
            .code-container-scroll { max-height: 300px; overflow-y: auto; overflow-x: auto; padding: 16px 6px 10px; border-radius: 0 0 5px 5px; border-right: 1px solid; border-left: 1px solid; border-bottom: 1px solid; border-color: #ffffff4a; background: var(--vscode-editor-background); }
            .code-block-header { display: flex; align-items: center; justify-content: space-between; padding: 5px 4px 5px 2px; border-radius: 5px 5px 0 0; background: #373737; }
            .code-block-box1 { display: flex; align-items: center; gap: 8px; }
            .code-block-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; opacity: 0.8; }
            .copy-btn, .code-collapse-btn { width: auto; padding: 3px 6px; font-size: 10px; background: rgba(255,255,255,0.1); color: #fff; z-index: 5; font-size: 12px; }
            .copy-btn:hover, .code-collapse-btn:hover { background: rgba(255,255,255,0.2); }
            .code-collapse-btn, .code-action-btn { width: auto; padding: 2px 5px; background: transparent; border: none; font-size: 11px; opacity: 0.75; }
            .code-collapse-btn:hover, .code-action-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }
            pre { margin: 0; font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace); font-size: clamp(12px, var(--vscode-editor-font-size, 12px), 14px); line-height: 1.55; color: var(--vscode-editor-foreground); }
            pre code { font-family: inherit; color: inherit; background: transparent; }

            /* Syntax wise styles */
            .tok-keyword { color: #569cd6; }
            .tok-string { color: #ce9178; }
            .tok-number { color: #b5cea8; }
            .tok-comment { color: #6a9955; }
            .tok-type { color: #4ec9b0; }
            .tok-function { color: #dcdcaa; }
            .tok-variable { color: #9cdcfe; }
            .tok-property { color: #9cdcfe; }
            .tok-operator { color: #d4d4d4; }
            /* Styled stop button */
            #stop-btn { background: var(--vscode-statusBarItem-errorBackground, #c74242); color: white; display: none; }
            #stop-btn:hover { background: #b03535; }
            /* NEW: Floating Scroll Anchor Arrow */
            #scroll-anchor { position: absolute; bottom: 15px; right: 20px; width: 32px; height: 32px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); z-index: 99; transition: opacity 0.2s ease, transform 0.2s ease; opacity: 0; pointer-events: none; transform: translateY(5px); }
            #scroll-anchor.visible { opacity: 0.9; pointer-events: auto; transform: translateY(0); }
            #scroll-anchor:hover { background: var(--vscode-button-hoverBackground); opacity: 1; }

            /* Animated Loading Spinner Element */
            .api-loading-dots { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; border-radius: 4px; margin-top: 5px; font-size: 12px; color: var(--vscode-descriptionForeground); }
            .loading-dot { width: 6px; height: 6px; background-color: var(--vscode-descriptionForeground); border-radius: 50%; animation: bounceDot 1.4s infinite ease-in-out both; }
            .loading-dot:nth-child(1) { animation-delay: -0.32s; }
            .loading-dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes bounceDot { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }

            * { scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
            /* 2. Webkit-specific customization to perfectly style scrollbars across platforms */
            #chat-log::-webkit-scrollbar, .code-container-scroll::-webkit-scrollbar, textarea::-webkit-scrollbar { display: none }

            /* Style the moving scrollbar handle using native VS Code theme colors */
            // #chat-log::-webkit-scrollbar-thumb, .code-container-scroll::-webkit-scrollbar-thumb, textarea::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); border-radius: 10px; }

            /* Brighten the scrollbar handle slightly when hovered */
            // #chat-log::-webkit-scrollbar-thumb:hover, .code-container-scroll::-webkit-scrollbar-thumb:hover, textarea::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }

            /* Keep the background track transparent so it looks completely seamless */
            // #chat-log::-webkit-scrollbar-track, .code-container-scroll::-webkit-scrollbar-track, textarea::-webkit-scrollbar-track { background: transparent; }
        </style>
    </head>
    <body>
        <div id="selection-box">
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
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px;">
            <div id="file-preview">No file attached</div>
            <div id="input-config-row">
                <button
                    id="main-config-btn"
                    type="button"
                    title="Open Main Config"
                >
                    Main Config ▼
                </button>
                <div id="main-config-menu">
                    <div class="config-menu-header">
                        Configs
                    </div>
                    <button
                        class="config-menu-item active"
                        type="button"
                    >
                        🖥️&nbsp;&nbsp;Main Config
                    </button>
                    <button
                        id="main-config-reload"
                        class="config-menu-item config-menu-reload"
                        type="button"
                    >
                        ⟳&nbsp;&nbsp;Reload
                    </button>
                </div>
            </div>
        </div>

        <!-- 4. Input Controls -->
        <div id="input-box">
            <textarea id="user-input" placeholder="Ask a question or request code..."></textarea>
            <div id="input-mode-row">
                <select id="input-mode" title="Select Mode">
                    <option value="chat">💬 Chat</option>
                    <option value="plan">📋 Plan</option>
                    <option value="agent">✏️ Agent</option>
                </select>
                <select id="model-select" title="Select AI Model">
                    <option value="">Loading models...</option>
                </select>
                <span
                    id="mode-info"
                    title="Ask questions and get answers"
                >ⓘ</span>
            </div>
        </div>
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
            let agentResponseDiv = null;
            let normalChatBusy = false;
            let isUserScrollingCodeBlock = false;
            let latestAgentValidation = null;
            let agentClarificationDiv = null;
            let currentMode = 'chat';
            let selectedModelId = null;
            let configuredModels = [];

            var MODE_INFO = {
                chat: 'Ask questions and get answers',
                plan: 'Create a step-by-step plan',
                agent: 'Plan and modify project files'
            };

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

            function highlightCode(code, language) {
                var result = '';
                var i = 0;
                var normalizedLanguage = String(language || '').toLowerCase();

                function unescapeHtml(value) {
                    return String(value)
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#039;/g, "'")
                        .replace(/&amp;/g, '&');
                }

                code = unescapeHtml(code);

                var isJavaScriptLike =
                    normalizedLanguage === 'js' ||
                    normalizedLanguage === 'jsx' ||
                    normalizedLanguage === 'ts' ||
                    normalizedLanguage === 'tsx' ||
                    normalizedLanguage === 'javascript' ||
                    normalizedLanguage === 'typescript' ||
                    normalizedLanguage === 'react';

                var keywords = new Set(['import', 'from', 'export', 'default', 'function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum', 'public', 'private', 'protected', 'readonly', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'as', 'satisfies', 'keyof', 'namespace', 'declare', 'abstract', 'static', 'get', 'set']);
                var types = new Set(['string', 'number', 'boolean', 'void', 'unknown', 'any', 'never', 'object', 'null', 'undefined', 'ReactNode', 'ReactElement', 'Promise']);

                function escape(value) {
                    return String(value)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                }

                function token(className, value) {
                    return (
                        '<span class="' +
                        className +
                        '">' +
                        escape(value) +
                        '</span>'
                    );
                }

                function isIdentifierStart(char) {
                    return /[A-Za-z_$]/.test(char);
                }

                function isIdentifierPart(char) {
                    return /[A-Za-z0-9_$]/.test(char);
                }

                if (!isJavaScriptLike) {
                    return escape(code);
                }

                while (i < code.length) {
                    var current = code[i];
                    var next = code[i + 1];

                    // Single-line comment
                    if (current === '/' && next === '/') {
                        var commentEnd = code.indexOf('\\n', i);
                        if (commentEnd === -1) {
                            commentEnd = code.length;
                        }
                        result += token('tok-comment', code.slice(i, commentEnd));
                        i = commentEnd;
                        continue;
                    }

                    // Multi-line comment
                    if (current === '/' && next === '*') {
                        var multiCommentEnd = code.indexOf('*/', i + 2);
                        if (multiCommentEnd === -1) {
                            multiCommentEnd = code.length - 2;
                        }
                        multiCommentEnd += 2;
                        result += token('tok-comment', code.slice(i, multiCommentEnd));
                        i = multiCommentEnd;
                        continue;
                    }

                    // Strings
                    if (
                        current === "'" ||
                        current === '"' ||
                        current === String.fromCharCode(96)
                    ) {
                        var quote = current;
                        var stringStart = i;
                        var stringEnd = i + 1;

                        while (stringEnd < code.length) {
                            if (code[stringEnd] === '\\\\') {
                                stringEnd += 2;
                                continue;
                            }
                            if (code[stringEnd] === quote) {
                                stringEnd++;
                                break;
                            }
                            stringEnd++;
                        }

                        result += token('tok-string', code.slice(stringStart, stringEnd));
                        i = stringEnd;
                        continue;
                    }

                    // Numbers
                    if (/[0-9]/.test(current)) {
                        var numberMatch =
                            code.slice(i).match(
                                /^(?:0x[\\da-f]+|\\d+(?:\\.\\d+)?)/i
                            );

                        if (numberMatch) {
                            result += token('tok-number', numberMatch[0]);
                            i += numberMatch[0].length;
                            continue;
                        }
                    }

                    // Identifiers / keywords / types / functions
                    if (isIdentifierStart(current)) {
                        var identifierStart = i;
                        i++;

                        while (i < code.length && isIdentifierPart(code[i])) {
                            i++;
                        }

                        var identifier = code.slice(identifierStart, i);
                        if (keywords.has(identifier)) {
                            result += token('tok-keyword', identifier);
                            continue;
                        }
                        if (types.has(identifier)) {
                            result += token('tok-type', identifier);
                            continue;
                        }

                        var remaining = code.slice(i);
                        var nextNonSpace = remaining.match(/^\\s*/);
                        var afterWhitespace = i + (nextNonSpace ? nextNonSpace[0].length : 0);

                        if (code[afterWhitespace] === '(') {
                            result += token('tok-function', identifier);
                            continue;
                        }
                        if (/^[A-Z]/.test(identifier)) {
                            result += token('tok-type', identifier);
                            continue;
                        }
                        result += token('tok-variable', identifier);
                        continue;
                    }
                    result += escape(current);
                    i++;
                }
                return result;
            }

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
                    var blockLanguage = lang ? lang.toUpperCase() : 'CODE';
                    return (
                        '<div class="code-block-wrapper" data-code-collapsed="false">' +
                            '<div class="code-block-header">' +
                                '<div class="code-block-box1">' +
                                    '<button ' +
                                        'class="code-collapse-btn" ' +
                                        'title="Collapse code"' +
                                        'type="button"' +
                                    '>' +
                                        '⌵' +
                                    '</button>' +
                                    '<span class="code-block-label">' +
                                        safeEscape(blockLanguage) +
                                    '</span>' +
                                '</div>' +
                                '<button ' +
                                    'class="code-action-btn copy-btn" ' +
                                    'title="Copy code"' +
                                    'type="button"' +
                                '>' +
                                    '⧉' +
                                '</button>' +
                                
                            '</div>' +
                            '<div class="code-container-scroll">' +
                                '<pre>' +
                                    '<code>' +
                                        highlightCode(code.trim(), lang) +
                                    '</code>' +
                                '</pre>' +
                            '</div>' +
                        '</div>'
                    );
                });

                // 3. HEADINGS
                formatted = formatted.replace(/^#### (.+)$/gm, '<h5 class="md-heading md-h4">$1</h5>');
                formatted = formatted.replace(/^### (.+)$/gm, '<h4 class="md-heading md-h3">$1</h4>');
                formatted = formatted.replace(/^## (.+)$/gm, '<h3 class="md-heading md-h2">$1</h3>');
                formatted = formatted.replace(/^# (.+)$/gm, '<h2 class="md-heading md-h1">$1</h2>');

                // 4. BOLD
                formatted = formatted.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');

                // 5. ITALIC
                formatted = formatted.replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g, '$1<em>$2</em>');

                // 6. INLINE CODE
                var inlineCodeRegex = new RegExp('\\x60([^\\x60\\n]+)\\x60', 'g');
                formatted = formatted.replace(inlineCodeRegex, '<code class="inline-code">$1</code>');

                // 7. UNORDERED LIST
                formatted = formatted.replace(
                    /^[ \\t]*[-*][ \\t]+(.+)$/gm,
                    '<li class="tmp-ul-item">$1</li>'
                );
                formatted = formatted.replace(
                    /((?:<li class="tmp-ul-item">.*<\\/li>(?:\\n|$))+)/g,
                    '<ul class="md-list">$1</ul>'
                );
                formatted = formatted.replace(/class="tmp-ul-item"/g, '');

                // 8. ORDERED LIST
                formatted = formatted.replace(
                    /^\\d+\\.[ \t]+(.+)$/gm,
                    '<li class="tmp-ol-item">$1</li>'
                );
                formatted = formatted.replace(
                    /((?:<li class="tmp-ol-item">.*<\\/li>(?:\\n)*)+)/g,
                    '<ol class="md-list">$1</ol>'
                );
                formatted = formatted.replace(/class="tmp-ol-item"/g, '');
                return formatted;
            }

            // NEW: Clipboard Copy Hook binder supporting nested layout elements
            function attachAllCopyListeners() {
                if (
                    chatLog.hasAttribute(
                        'data-copy-delegated'
                    )
                ) {
                    return;
                }

                chatLog.setAttribute(
                    'data-copy-delegated',
                    'true'
                );

                chatLog.addEventListener(
                    'click',
                    function(event) {

                        var target =
                            event.target;

                        if (
                            !target ||
                            !target.closest
                        ) {
                            return;
                        }

                        var button =
                            target.closest(
                                '.copy-btn'
                            );

                        if (!button) {
                            return;
                        }

                        var wrapper =
                            button.closest(
                                '.code-block-wrapper'
                            );

                        if (!wrapper) {
                            return;
                        }

                        var codeElement =
                            wrapper.querySelector(
                                '.code-container-scroll code'
                            );

                        if (!codeElement) {
                            return;
                        }

                        navigator.clipboard.writeText(
                            codeElement.innerText
                        );

                        var originalText =
                            button.innerText;

                        var originalTitle =
                            button.title;

                        button.innerText =
                            '✓';

                        button.title =
                            'Copied';

                        setTimeout(
                            function() {
                                /*
                                * The button may have been replaced by
                                * another streaming render, so first check
                                * that it is still connected.
                                */
                                if (
                                    !button.isConnected
                                ) {
                                    return;
                                }

                                button.innerText =
                                    originalText;

                                button.title =
                                    originalTitle ||
                                    'Copy code';
                            },
                            1200
                        );
                    }
                );
            }

            function attachCodeBlockActionListeners() {
                if (
                    chatLog.hasAttribute(
                        'data-collapse-delegated'
                    )
                ) {
                    return;
                }

                chatLog.setAttribute(
                    'data-collapse-delegated',
                    'true'
                );

                chatLog.addEventListener(
                    'click',
                    function(event) {

                        var target =
                            event.target;

                        if (
                            !target ||
                            !target.closest
                        ) {
                            return;
                        }

                        var button =
                            target.closest(
                                '.code-collapse-btn'
                            );

                        if (!button) {
                            return;
                        }

                        var wrapper =
                            button.closest(
                                '.code-block-wrapper'
                            );

                        if (!wrapper) {
                            return;
                        }

                        var codeContainer =
                            wrapper.querySelector(
                                '.code-container-scroll'
                            );

                        if (!codeContainer) {
                            return;
                        }

                        var isCollapsed =
                            wrapper.getAttribute(
                                'data-code-collapsed'
                            ) === 'true';

                        if (isCollapsed) {

                            wrapper.setAttribute(
                                'data-code-collapsed',
                                'false'
                            );

                            codeContainer.style.display =
                                'block';

                            button.innerText =
                                '⌵';

                            button.title =
                                'Collapse code';

                        } else {

                            wrapper.setAttribute(
                                'data-code-collapsed',
                                'true'
                            );

                            codeContainer.style.display =
                                'none';

                            button.innerText = '⌵';
                            button.title = 'Expand code';
                            button.style.transform = 'rotate(270deg)';
                        }
                    }
                );
            }
            
            function attachCodeBlockScrollListeners() {
                document
                    .querySelectorAll(
                        '.code-container-scroll'
                    )
                    .forEach(
                        function(container) {

                            if (
                                container.hasAttribute(
                                    'data-scroll-hooked'
                                )
                            ) {
                                return;
                            }

                            container.setAttribute(
                                'data-scroll-hooked',
                                'true'
                            );

                            container.addEventListener(
                                'wheel',
                                function() {
                                    isUserScrollingCodeBlock =
                                        true;
                                },
                                {
                                    passive: true
                                }
                            );

                            container.addEventListener(
                                'touchstart',
                                function() {
                                    isUserScrollingCodeBlock =
                                        true;
                                },
                                {
                                    passive: true
                                }
                            );

                            container.addEventListener(
                                'pointerdown',
                                function() {
                                    isUserScrollingCodeBlock =
                                        true;
                                }
                            );
                        }
                    );
            }

            document.addEventListener(
                'pointerup',
                function() {
                    setTimeout(
                        function() {
                            isUserScrollingCodeBlock =
                                false;
                        },
                        300
                    );
                }
            );
            document.addEventListener(
                'touchend',
                function() {
                    setTimeout(
                        function() {
                            isUserScrollingCodeBlock =
                                false;
                        },
                        300
                    );
                }
            );

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
                var sendButton = document.getElementById('send-btn');
                var stopButton = document.getElementById('stop-btn');
                var userInput = document.getElementById('user-input');
                var modelSelect = document.getElementById('model-select');
                if (sendButton) {
                    sendButton.style.display = 'block';
                }
                if (stopButton) {
                    stopButton.style.display = 'none';
                }
                if (userInput) {
                    userInput.disabled = false;
                }
                if (modelSelect) {
                    modelSelect.disabled = false;
                    modelSelect.style.opacity = '1';
                }
                normalChatBusy = false;
                var activeLoader = document.getElementById('ai-embedded-loader');
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
            
            function safeEscape(value) {
                return String(value ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }
            
            function renderAgentResponse(changes) {
                var chatLog = document.getElementById('chat-log');
                if (!chatLog) { return; }
                if (agentResponseDiv) {
                    agentResponseDiv.remove();
                    agentResponseDiv = null;
                }
                if (!Array.isArray(changes) || changes.length === 0) {
                    return;
                }
                agentResponseDiv = document.createElement('div');
                agentResponseDiv.className = 'msg ai-msg';
                var html = '<div style="font-weight:600;">' +
                    '📝 Agent Response' +
                '</div>';
                changes.forEach(function(change) {
                    var safePath = safeEscape(change.path || '');
                    html += '<div style="' +
                        'margin-top:10px;' +
                        'font-size:11px;' +
                        'opacity:0.8;' +
                    '">' +
                        safePath +
                    '</div>';

                    if (change.operation === 'modify' && typeof change.newContent === 'string') {
                        html += '<div class="code-block-wrapper">' +
                            '<button class="copy-btn">Copy</button>' +
                            '<div class="code-container-scroll" ' +
                                'style="max-height:120px;overflow-y:auto;overflow-x:auto;">' +
                                '<pre>' +
                                    '<code>' +
                                        safeEscape(
                                            change.newContent
                                        ) +
                                    '</code>' +
                                '</pre>' +
                            '</div>' +
                        '</div>';
                    }
                });

                agentResponseDiv.innerHTML = html;
                chatLog.appendChild(agentResponseDiv);
                attachAllCopyListeners();
                attachCodeBlockScrollListeners();
                attachCodeBlockActionListeners();
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

            function renderConfiguredModels(
                models,
                selectedId
            ) {
                var modelSelect = document.getElementById('model-select');
                if (!modelSelect) { return; }
                configuredModels = Array.isArray(models) ? models : [];

                var chatModels =
                    configuredModels.filter(
                        function(model) {
                            return (
                                Array.isArray(model.roles) &&
                                model.roles.includes('chat')
                            );
                        }
                    );

                modelSelect.innerHTML = '';

                if (chatModels.length === 0) {
                    var emptyOption = document.createElement('option');
                    emptyOption.value = '';
                    emptyOption.textContent = 'No Chat models configured';
                    modelSelect.appendChild(emptyOption);
                    selectedModelId = null;
                    return;
                }

                chatModels.forEach(
                    function(model) {
                        var option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.name;
                        modelSelect.appendChild(option);
                    }
                );

                var requestedId = selectedId || selectedModelId;
                var selectedModel =
                    chatModels.find(
                        function(model) {
                            return (model.id === requestedId);
                        }
                    );

                if (!selectedModel) {
                    selectedModel = chatModels[0];
                }

                selectedModelId = selectedModel.id;
                modelSelect.value = selectedModel.id;
            }

            function updateModelSelectorForMode() {
                if (!modelSelect) {
                    return;
                }
                var previousSelectedModelId = selectedModelId;
                var requiredRoles = [];

                if (currentMode === 'chat') {
                    requiredRoles = ['chat'];
                } else if (currentMode === 'plan') {
                    requiredRoles = ['planner'];
                } else if (currentMode === 'agent') {
                    requiredRoles = ['resolver'];
                    // requiredRoles = ['resolver', 'planner', 'changeGenerator'];
                } else {
                    requiredRoles = ['chat'];
                }

                var modeModels = configuredModels.filter(
                    function(model) {
                        return (
                            Array.isArray(model.roles) &&
                            requiredRoles.every(
                                function(role) {
                                    return model.roles.includes(role);
                                }
                            )
                        );
                    }
                );

                modelSelect.innerHTML = '';

                if (modeModels.length === 0) {
                    var emptyOption = document.createElement('option');

                    emptyOption.value = '';
                    emptyOption.textContent = 'No models available';
                    modelSelect.appendChild(emptyOption);
                    selectedModelId = null;
                    modelSelect.disabled = true;
                    modelSelect.style.opacity = '0.55';
                    modelSelect.style.cursor = 'not-allowed';
                    return;
                }

                modeModels.forEach(
                    function(model) {
                        var option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.name;
                        modelSelect.appendChild(option);
                    }
                );

                var selectedModel =
                    modeModels.find(
                        function(model) {
                            return model.id === selectedModelId;
                        }
                    );

                if (!selectedModel) {
                    selectedModel = modeModels[0];
                }

                selectedModelId = selectedModel.id;
                modelSelect.value = selectedModel.id;

                modelSelect.disabled = false;
                modelSelect.style.opacity = '1';
                modelSelect.style.cursor = 'pointer';

                if (selectedModelId !== previousSelectedModelId) {
                    vscode.postMessage({
                        command: 'selectModel',
                        modelId: selectedModelId
                    });
                }
                updateModelSelectorForMode();
            }
            
            function submitCurrentMode() {
                var userInputEl = document.getElementById('user-input');
                if (!userInputEl) return;
                var text = userInputEl.value.trim();
                if (!text && !base64Attachment) return;

                switch (currentMode) {
                    case 'agent':
                        submitAgentRequest();
                        break;
                    case 'plan':
                        submitPlanRequest();
                        break;
                    case 'chat':
                    default:
                        submitChatRequest();
                        break;
                }
            }

            function submitPlanRequest() {
                showAgentStatus('📋 Plan mode is not implemented yet.');
            }

            function submitAgentRequest() {
                if (normalChatBusy) {
                    showAgentStatus(
                        '⚠️ Stop the current AI generation before starting an Agent task.'
                    );
                    return;
                }
                var userInputEl = document.getElementById('user-input');
                if (!userInputEl) { return; }
                var text = userInputEl.value.trim();
                if (!text) { return; }
                if (!selectedModelId) {
                    showAgentStatus(
                        'No compatible Agent model is configured. Check the model roles in Main Config.'
                    );
                    return;
                }
                setAgentButtonBusy(true);
                removeAgentValidation();
                var chatLog = document.getElementById('chat-log');
                if (!chatLog) { return; }
                var safeText = safeEscape(text);

                chatLog.innerHTML +=
                    '<div class="msg user-msg">' +
                        '<b style="font-size: 13px;">You → Agent:</b>' +
                        '<div class="user-content" ' +
                            'style="white-space: pre-wrap; margin-top: 4px;">' +
                            safeText +
                        '</div>' +
                    '</div>';

                scrollToBottom();
                createAgentProgress();
                updateAgentProgress('planning', 'Understanding your request...');
                vscode.postMessage({
                    command: 'agentRequest',
                    message: text,
                    modelId: selectedModelId
                });
                userInputEl.value = '';
                userInputEl.style.height = DEFAULT_HEIGHT;
            }

            function submitChatRequest() {
                const userInputEl = document.getElementById('user-input');
                if (!userInputEl) { return; }
                const text = userInputEl.value.trim();
                if (!text && !base64Attachment) return;

                normalChatBusy = true;
                // Lock out alternative input configurations while streaming is active
                document.getElementById('send-btn').style.display = 'none';
                document.getElementById('stop-btn').style.display = 'block';
                userInputEl.disabled = true;
                if (modelSelect) {
                    modelSelect.disabled = true;
                }

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

            textarea.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitCurrentMode();
                }
            });

            document.getElementById('agent-btn').addEventListener('click', function() {
                currentMode = 'agent';
                if (inputMode) {
                    inputMode.value = 'agent';
                }
                updateModelSelectorForMode();
                submitAgentRequest();
            });

            // Send Prompt Pipeline
            document.getElementById('send-btn').addEventListener('click', function() {
                submitCurrentMode();
            });

            var inputMode = document.getElementById('input-mode');
            var modelSelect = document.getElementById('model-select');
            var modeInfo = document.getElementById('mode-info');

            var mainConfigBtn = document.getElementById('main-config-btn');
            var mainConfigMenu = document.getElementById('main-config-menu');
            var mainConfigReload = document.getElementById('main-config-reload');
            var mainConfigItem = document.querySelector('#main-config-menu .config-menu-item.active');

            if (mainConfigBtn && mainConfigMenu) {
                mainConfigBtn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    mainConfigMenu.classList.toggle('visible');
                });
            }

            if (mainConfigMenu) {
                mainConfigMenu.addEventListener('click', function(event) {
                    event.stopPropagation();
                });
            }

            document.addEventListener('click', function() {
                if (mainConfigMenu) {
                    mainConfigMenu.classList.remove('visible');
                }
            });

            if (mainConfigItem) {
                mainConfigItem.addEventListener('click', function() {
                    vscode.postMessage({
                        command: 'openMainConfig'
                    });
                    if (mainConfigMenu) {
                        mainConfigMenu.classList.remove('visible');
                    }
                });
            }
            if (mainConfigReload) {
                mainConfigReload.addEventListener('click', function() {
                    vscode.postMessage({
                        command: 'reloadConfig'
                    });
                    if (mainConfigMenu) {
                        mainConfigMenu.classList.remove('visible');
                    }
                });
            }

            if (inputMode) {
                inputMode.value = currentMode;
                if (modeInfo) {
                    modeInfo.title = MODE_INFO[currentMode] || '';
                }
                inputMode.addEventListener('change', function() {
                    currentMode = inputMode.value;
                    if (modeInfo) {
                        modeInfo.title = MODE_INFO[currentMode] || '';
                    }
                    updateModelSelectorForMode();
                });
            }
            updateModelSelectorForMode();

            if (modelSelect) {
                modelSelect.addEventListener('change', function() {
                    selectedModelId = modelSelect.value;
                    if (!selectedModelId) { return; }
                    vscode.postMessage({
                        command: 'selectModel',
                        modelId: selectedModelId
                    });
                });
            }

            function renderAgentClarification(message, options, allowRewrite) {
                var chatLog = document.getElementById('chat-log');
                if (!chatLog) { return; }
                // Remove an older clarification card.
                if (agentClarificationDiv) {
                    agentClarificationDiv.remove();
                    agentClarificationDiv = null;
                }
                agentClarificationDiv = document.createElement('div');
                agentClarificationDiv.className = 'msg ai-msg';
                agentClarificationDiv.id = 'agent-clarification-card';

                var safeMessage = safeEscape(message || 'Please clarify your request.');
                var optionsHtml = '';

                if (Array.isArray(options)) {
                    options.forEach(function(option, index) {
                        optionsHtml +=
                            '<button ' +
                                'class="agent-clarification-option" ' +
                                'data-option-index="' +
                                    index +
                                '" ' +
                                'style="' +
                                    'display:block;' +
                                    'width:100%;' +
                                    'text-align:left;' +
                                    'margin-top:6px;' +
                                    'white-space:normal;' +
                                    'word-break:break-word;' +
                                '"' +
                            '>' +
                                safeEscape(
                                    option.label
                                ) +
                            '</button>';
                        }
                    );
                }

                var rewriteHtml = allowRewrite
                    ? (
                        '<div style="margin-top:12px;">' +
                            '<textarea ' +
                                'id="agent-clarification-rewrite" ' +
                                'placeholder="Rewrite the request more clearly..." ' +
                                'style="' +
                                    'width:100%;' +
                                    'min-height:60px;' +
                                    'resize:vertical;' +
                                '"' +
                            '></textarea>' +
                            '<button ' +
                                'id="agent-clarification-rewrite-btn" ' +
                                'style="' +
                                    'width:auto;' +
                                    'margin-top:6px;' +
                                '"' +
                            '>' +
                                'Rewrite & Retry' +
                            '</button>' +

                        '</div>'
                    )
                    : '';

                agentClarificationDiv.innerHTML =
                    '<div style="' +
                        'font-weight:600;' +
                        'font-size:13px;' +
                    '">' +
                        '❓ Agent Needs Clarification' +
                    '</div>' +

                    '<div style="' +
                        'margin-top:7px;' +
                        'font-size:12px;' +
                        'line-height:1.5;' +
                    '">' +
                        safeMessage +
                    '</div>' +

                    '<div style="' +
                        'margin-top:10px;' +
                    '">' +
                        optionsHtml +
                    '</div>' +

                    rewriteHtml;

                chatLog.appendChild(agentClarificationDiv);

                var optionButtons =
                    agentClarificationDiv.querySelectorAll(
                        '.agent-clarification-option'
                    );

                optionButtons.forEach(function(button) {
                    button.addEventListener('click', function() {
                        var index = Number(button.getAttribute('data-option-index'));
                        var option = options[index];
                        if (!option) return;

                        optionButtons.forEach(
                            function(otherButton) {
                                otherButton.disabled = true;
                                otherButton.style.opacity = '0.6';
                                otherButton.style.cursor = 'not-allowed';
                            }
                        );

                        if (agentClarificationDiv) {
                            agentClarificationDiv.remove();
                            agentClarificationDiv = null;
                        }
                        setAgentButtonBusy(true);
                        vscode.postMessage({
                            command: 'agentClarificationSelected',
                            instruction: option.instruction,
                            modelId: selectedModelId
                        });
                    });
                });

                /*
                * ---------------------------------------------------------
                * REWRITE
                * ---------------------------------------------------------
                */
                var rewriteButton =
                    agentClarificationDiv.querySelector(
                        '#agent-clarification-rewrite-btn'
                    );

                if (rewriteButton) {
                    rewriteButton.addEventListener(
                        'click',
                        function() {
                            var input =
                                agentClarificationDiv.querySelector(
                                    '#agent-clarification-rewrite'
                                );

                            var rewritten =
                                input
                                    ? input.value.trim()
                                    : '';

                            if (!rewritten) {
                                return;
                            }

                            rewriteButton.disabled =
                                true;

                            rewriteButton.innerText =
                                'Retrying...';

                            rewriteButton.style.opacity =
                                '0.6';

                            vscode.postMessage({
                                command: 'agentClarificationRewrite',
                                instruction: rewritten,
                                modelId: selectedModelId
                            });
                        }
                    );
                }

                scrollToBottom();
            }

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

            function renderAgentValidation(validation) {
                var chatLog = document.getElementById('chat-log');

                if (!chatLog || !validation) {
                    return;
                }

                /*
                * Prevent duplicate validation cards.
                */
                var existingValidation = document.getElementById('agent-validation-card');

                if (existingValidation) {
                    existingValidation.remove();
                }

                var validationDiv = document.createElement('div');
                validationDiv.className = 'msg ai-msg';
                validationDiv.id = 'agent-validation-card';

                var statusIcon =
                    validation.status === 'passed'
                        ? '✅'
                        : validation.status === 'failed'
                            ? '⚠️'
                            : '⏭️';

                var statusText =
                    validation.status === 'passed'
                        ? 'Project validation passed'
                        : validation.status === 'failed'
                            ? 'Project validation found problems'
                            : 'Project validation was skipped';

                var resultsHtml = '';

                if (Array.isArray(validation.results) && validation.results.length > 0) {
                    validation.results.forEach(
                        function(result) {
                            var resultIcon =
                                result.status === 'passed'
                                    ? '✅'
                                    : result.status === 'failed'
                                        ? '❌'
                                        : '⏭️';

                            resultsHtml +=
                                '<div style="' +
                                    'padding: 8px;' +
                                    'margin-top: 6px;' +
                                    'border: 1px solid var(--vscode-panel-border);' +
                                    'border-radius: 4px;' +
                                    'background: var(--vscode-editor-background);' +
                                '">' +

                                    '<div style="' +
                                        'font-weight: 600;' +
                                        'font-size: 12px;' +
                                    '">' +
                                        resultIcon +
                                        ' ' +
                                        safeEscape(
                                            result.type ||
                                            'Validation'
                                        ) +
                                    '</div>' +

                                    (
                                        result.command
                                            ? '<div style="' +
                                                'margin-top: 4px;' +
                                                'font-size: 10px;' +
                                                'opacity: 0.75;' +
                                                'word-break: break-word;' +
                                            '">' +
                                                safeEscape(
                                                    result.command
                                                ) +
                                            '</div>'
                                            : ''
                                    ) +

                                    (
                                        result.output
                                            ? '<details style="margin-top: 6px;">' +
                                                '<summary style="' +
                                                    'font-size: 10px;' +
                                                    'cursor: pointer;' +
                                                '">' +
                                                    'Output' +
                                                '</summary>' +

                                                '<pre style="' +
                                                    'margin-top: 5px;' +
                                                    'max-height: 180px;' +
                                                    'overflow: auto;' +
                                                    'white-space: pre-wrap;' +
                                                    'font-size: 10px;' +
                                                    'font-family: monospace;' +
                                                '">' +
                                                    safeEscape(
                                                        result.output
                                                    ) +
                                                '</pre>' +

                                            '</details>'
                                            : ''
                                    ) +
                                '</div>';
                        }
                    );
                }

                validationDiv.innerHTML =
                    '<div style="' +
                        'font-weight: 600;' +
                        'font-size: 13px;' +
                    '">' +
                        '🔍 Validation' +
                    '</div>' +

                    '<div style="margin-top: 6px;">' +
                        statusIcon +
                        ' ' +
                        safeEscape(
                            statusText
                        ) +
                    '</div>' +

                    (
                        validation.summary
                            ? '<div style="' +
                                'margin-top: 6px;' +
                                'font-size: 11px;' +
                                'line-height: 1.4;' +
                                'white-space: pre-wrap;' +
                                'opacity: 0.8;' +
                            '">' +
                                safeEscape(
                                    validation.summary
                                ) +
                            '</div>'
                            : ''
                    ) +

                    '<div style="margin-top: 8px;">' +
                        resultsHtml +
                    '</div>' +

                    '<div style="margin-top: 10px;">' +
                        '<button ' +
                            'id="undo-agent-changes-btn" ' +
                            'style="' +
                                'width:auto;' +
                            '"' +
                        '>' +
                            '↩ Undo Changes' +
                        '</button>' +
                    '</div>';

                /*
                * Add the validation card first.
                */
                chatLog.appendChild(validationDiv);

                /*
                * Bind Undo button AFTER the card exists in the DOM.
                */
                var undoButton = validationDiv.querySelector('#undo-agent-changes-btn');

                if (undoButton) {
                    undoButton.addEventListener(
                        'click',
                        function() {
                            undoButton.disabled = true;
                            undoButton.innerText = 'Undoing...';
                            undoButton.style.opacity = '0.6';
                            undoButton.style.cursor = 'not-allowed';
                            vscode.postMessage({command:'undoAgentChanges'});
                        }
                    );
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
                    id: 'validation',
                    label: 'Validating project'
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

            function removeAgentValidation() {
                var validationDiv = document.getElementById('agent-validation-card');
                if (validationDiv) { validationDiv.remove(); }
                latestAgentValidation = null;
            }

            function setAgentButtonBusy(busy) {
                var agentButton = document.getElementById('agent-btn');
                var sendButton = document.getElementById('send-btn');
                var modeSelect = document.getElementById('input-mode');
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
                if (modeSelect) {
                    modeSelect.disabled = busy;
                    modeSelect.style.opacity = busy ? '0.6' : '1';
                    modeSelect.style.cursor = busy ? 'not-allowed' : 'pointer';
                }
            }

            // Stream Receiver Event Listener Loop
            window.addEventListener('message', event => {
                const message = event.data;

                switch (message.command) {
                    case 'configuredModels':
                        renderConfiguredModels(
                            message.models,
                            message.selectedModelId
                        );
                        break;
                    case 'modelSelected':
                        if (message.model && message.model.id) {
                            selectedModelId = message.model.id;
                            if (modelSelect) {
                                modelSelect.value = message.model.id;
                            }
                        }
                        break;
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
                            var embeddedLoader =
                                currentStreamDiv.querySelector(
                                    '#ai-embedded-loader'
                                );

                            if (embeddedLoader) {
                                embeddedLoader.remove();
                            }

                            var oldCodeContainers =
                                currentStreamDiv.querySelectorAll(
                                    '.code-container-scroll'
                                );

                            var oldCodeWrappers =
                                currentStreamDiv.querySelectorAll(
                                    '.code-block-wrapper'
                                );

                            var previousCodeStates =
                                [];

                            oldCodeWrappers.forEach(
                                function(wrapper, index) {

                                    var container =
                                        wrapper.querySelector(
                                            '.code-container-scroll'
                                        );

                                    previousCodeStates[index] = {
                                        collapsed:
                                            wrapper.getAttribute(
                                                'data-code-collapsed'
                                            ) === 'true',

                                        scrollTop:
                                            container
                                                ? container.scrollTop
                                                : 0
                                    };
                                }
                            );

                            currentResponseText +=
                                message.text;

                            var contentSpan =
                                currentStreamDiv.querySelector(
                                    '.stream-content'
                                );

                            if (!contentSpan) {
                                return;
                            }

                            /*
                            * Re-render Markdown.
                            */
                            contentSpan.innerHTML =
                                formatMarkdownStream(
                                    currentResponseText
                                );

                            /*
                            * Restore code-block state.
                            */
                            var newCodeWrappers =
                                currentStreamDiv.querySelectorAll(
                                    '.code-block-wrapper'
                                );

                            newCodeWrappers.forEach(
                                function(wrapper, index) {

                                    var state =
                                        previousCodeStates[index];

                                    if (!state) {
                                        return;
                                    }

                                    var container =
                                        wrapper.querySelector(
                                            '.code-container-scroll'
                                        );

                                    var collapseButton =
                                        wrapper.querySelector(
                                            '.code-collapse-btn'
                                        );

                                    if (
                                        state.collapsed
                                    ) {
                                        wrapper.setAttribute(
                                            'data-code-collapsed',
                                            'true'
                                        );

                                        if (container) {
                                            container.style.display =
                                                'none';
                                        }

                                        if (collapseButton) {
                                            collapseButton.innerText = '⌵';
                                            collapseButton.title = 'Expand code';
                                            collapseButton.style.transform = 'rotate(270deg)';
                                        }

                                    } else {
                                        wrapper.setAttribute(
                                            'data-code-collapsed',
                                            'false'
                                        );

                                        if (container) {
                                            container.style.display =
                                                'block';

                                            container.scrollTop =
                                                state.scrollTop;
                                        }

                                        if (collapseButton) {
                                            collapseButton.innerText =
                                                '⌵';

                                            collapseButton.title =
                                                'Collapse code';
                                        }
                                    }
                                }
                            );

                            /*
                            * The listeners are delegated to chatLog, so these calls
                            * are harmless after the first invocation.
                            */
                            attachAllCopyListeners();
                            attachCodeBlockActionListeners();
                            attachCodeBlockScrollListeners();

                            if (
                                !isUserScrolledUp &&
                                !isUserScrollingCodeBlock
                            ) {
                                chatLog.scrollTop =
                                    chatLog.scrollHeight;
                            }
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
                    
                    case 'agentResponse':
                        renderAgentResponse(message.changes);
                        break;
                    case "agentProgress":
                        setAgentButtonBusy(true);
                        updateAgentProgress(message.stage, message.text);
                        break;
                    case 'agentClarification':
                        setAgentButtonBusy(false);
                        if (agentProgressDiv) {
                            agentProgressDiv.remove();
                            agentProgressDiv = null;
                        }
                        renderAgentClarification(
                            message.message,
                            message.options,
                            message.allowRewrite !== false
                        );
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
                    case 'agentValidationResult':
                        latestAgentValidation = message.validation;
                        break;

                    case 'agentExecutionCompleted': {
                        setAgentButtonBusy(false);
                        if (agentPlanDiv) {
                            agentPlanDiv.remove();
                            agentPlanDiv = null;
                        }
                        if (agentReviewDiv) {
                            agentReviewDiv.remove();
                            agentReviewDiv = null;
                        }
                        completeAgentProgress('Agent task completed.');
                        if (message.validation) {
                            latestAgentValidation = message.validation;
                            renderAgentValidation(message.validation);
                        }
                        break;
                    }
                    
                    case 'agentChangesUndone': {
                        var undoButton = document.getElementById('undo-agent-changes-btn');
                        if (undoButton) {
                            undoButton.disabled = true;
                            undoButton.innerText = '↩ Changes Undone';
                            undoButton.style.opacity = '0.6';
                            undoButton.style.cursor = 'not-allowed';
                        }
                        showAgentStatus('↩ Agent changes successfully undone.');
                        break;
                    }
                    
                    case 'agentUndoFailed':
                        var undoRetryButton = document.getElementById('undo-agent-changes-btn');
                        if (undoRetryButton) {
                            undoRetryButton.disabled = false;
                            undoRetryButton.innerText = '↩ Undo Changes';
                            undoRetryButton.style.opacity = '1';
                            undoRetryButton.style.cursor = 'pointer';
                        }
                        showAgentStatus('❌ ' + message.text);
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
                        if (agentClarificationDiv) {
                            agentClarificationDiv.remove();
                            agentClarificationDiv = null;
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
                        attachCodeBlockActionListeners();
                        if (!isUserScrolledUp) scrollToBottom();
                        break;
                }
            });

            console.log('FreeCopilot WebView initialization complete');
        </script>
    </body>
    </html>`;
}
