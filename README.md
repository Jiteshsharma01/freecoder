# 🚀 Free AI Copilot for VS Code

A lightweight, private, and customizable AI code assistant sidebar. This tool connects directly to free external AI tools or your locally running models, giving you full control over your development environment.

## ✨ Core Features

```
```

* **🦙 Local AI Support:** Connects directly to local engines like Ollama running heavy models (`qwen3-coder:30b`).
* **🗺️ Project Structure Mapping:** Generates a `project_blueprint.md` map file at your project root to provide your AI model with a high-level understanding of the project's structure.
* **🕸️ Knowledge Graph & Visualization:** Analyzes source-file relationships such as imports and dependencies, generates a local `.freecopilot/knowledge-graph.json`, and provides an interactive visual representation of your project's architecture.
* **⏳ Real-time Token Streaming:** Watch your answers generate instantly token-by-token instead of waiting for long code generation cycles.
* **🛑 Execution Interruption:** Stop generations immediately with a built-in "Stop" cancel button if you want to rewrite your question.
* **📁 Smart Code Viewports:** Code snippets are isolated into independent windows locked to a compact ~70px height limit with thin custom scrollbars.
* **📎 Clipboard Copy Actions:** Quick click "Copy" triggers are automatically attached to every generated code block window.
* **🔒 Multi-Tab State Persistence:** Your text, active chat history, and sidebar position are preserved when switching extension views.

## 🧠 Project Analysis, Mapping & Knowledge Graph

FreeCopilot analyzes the opened project once and uses the resulting project analysis as the common source for both the project map and knowledge graph.

### 🔍 Project Analysis Flow

The project analysis layer is designed to be technology-agnostic and can be extended to support different project types such as:

* React / JavaScript / TypeScript
* Next.js 13 / 14 / 15
* PHP
* Laravel
* Other frameworks and languages in the future

The analysis pipeline follows this architecture:

```text
User Action
    │
    ├── Generate Project Map
    │
    └── Generate Knowledge Graph
             │
             ▼
      analyzeProject()
             │
             ├── Scan project files
             ├── Detect project/framework
             ├── Classify files
             └── Build ProjectAnalysis
             │
             ▼
       ProjectAnalysis
          /        \
         /          \
        ▼            ▼
Project Map     Knowledge Graph
    │                 │
    ▼                 ▼
project_blueprint.md  knowledge-graph.json
                      │
                      ▼
                Graph Visualization
```

### 🤖 Why Both Are Useful

The two outputs serve different purposes.

| Feature                               | Project Map | Knowledge Graph |
| ------------------------------------- | ----------- | --------------- |
| Directory structure                   | ✅          | Optional        |
| File inventory                        | ✅          | ✅              |
| Human-readable                        | ✅          | ❌              |
| AI context                            | ✅          | ✅              |
| Import relationships                  | ❌          | ✅              |
| Dependency relationships              | ❌          | ✅              |
| Interactive visualization             | ❌          | ✅              |
| Architecture exploration              | Basic       | Advanced        |
| Suitable for future code intelligence | Limited     | ✅              |

The **Project Map** answers:

> "What does this project look like?"

The **Knowledge Graph** answers:

> "How are the parts of this project connected?"

Together they provide both **structural context** and **relationship context** for AI-assisted development.

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

* Switch your model provider dropdown to **Gemini Flash** or alternate online services if you need to upload visual file images for processing. (Future implementaion)
* Once verified, you are 100% ready to package the clean production build file use following command: `vsce package --allow-missing-repository`

## 🚀 How To Use

1. Click on the **Speech Bubble Icon** in your VS Code left sidebar panel.
2. Select your active backend model inside the **AI Provider Tool** dropdown list.
3. Use **🗺️ Map** to create a human-readable project overview, or use **🕸️ Graph** to analyze source-file relationships and open an interactive architecture visualization.
4. Type your prompt instructions or code questions inside the textarea box and hit **Send Message**.
5. Click **Stop** at any time to freeze active code creation streams.
6. Click **🗑️ Clear** to instantly sweep away your message logs and restart a fresh conversation session.

## 📦 How to Install From File (.VSIX)

If this extension was shared with you privately as a standalone bundle file:

1. Open VS Code and navigate to the **Extensions tab** (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Click the **three dots (...)** button positioned in the top right corner of the Extensions menu panel view.
3. Choose **Install from VSIX...** from the dropdown options.
4. Select the `freecopilot-0.0.1.vsix` file from your local disk and click open to activate it instantly.
