# 🚀 Free AI Copilot for VS Code

A lightweight, private, and customizable AI code assistant sidebar. This tool connects directly to free external AI tools or your locally running models, giving you full control over your development environment.

## ✨ Core Features

* **🦙 Local AI Support:** Connects directly to local engines like Ollama running heavy models (`qwen3-coder:30b`).
* **🗺️ Project Structure Mapping:** Generates a `project_blueprint.md` map file at your project root to feed into your AI model context.
* **⏳ Real-time Token Streaming:** Watch your answers generate instantly token-by-token instead of waiting for long code generation cycles.
* **🛑 Execution Interruption:** Stop generations immediately with a built-in "Stop" cancel button if you want to rewrite your question.
* **📁 Smart Code Viewports:** Code snippets are isolated into independent windows locked to a compact ~70px height limit with thin custom scrollbars.
* **📎 Clipboard Copy Actions:** Quick click "Copy" triggers are automatically attached to every generated code block window.
* **🔒 Multi-Tab State Persistence:** Your text, active chat history, and sidebar position are preserved when switching extension views.

## 🛠️ Requirements & Setup

Before running this extension, make sure you configure your background AI engine:

### 1. Local Ollama Integration (Default)

1. Download and install [Ollama](https://ollama.com).
2. Open your terminal and pull down your target model weights:
   ```bash
   ollama pull qwen3-coder:30b
   ```
3. Keep the Ollama app background server running while typing queries.

### 2. Multi-Modal Assets (Gemini / Free API)

* Switch your model provider dropdown to **Gemini Flash** or alternate online services if you need to upload visual file images for processing.

## 🚀 How To Use

1. Click on the **Speech Bubble Icon** in your VS Code left sidebar panel.
2. Select your active backend model inside the **AI Provider Tool** dropdown list.
3. Click the **🗺️ Generate Project Structure Map** button first. This creates a blueprint tree file of your directory so the AI has full situational awareness of your project context.
4. Type your prompt instructions or code questions inside the textarea box and hit **Send Message**.
5. Click **Stop** at any time to freeze active code creation streams.
6. Click **🗑️ Clear** to instantly sweep away your message logs and restart a fresh conversation session.

## 📦 How to Install From File (.VSIX)

If this extension was shared with you privately as a standalone bundle file:

1. Open VS Code and navigate to the **Extensions tab** (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Click the **three dots (...)** button positioned in the top right corner of the Extensions menu panel view.
3. Choose **Install from VSIX...** from the dropdown options.
4. Select the `freecopilot-0.0.1.vsix` file from your local disk and click open to activate it instantly.
