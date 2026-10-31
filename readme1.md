
# 🚀 Free AI Coder for VS Code

A lightweight, private, and customizable AI code assistant sidebar. FreeCoder connects directly to locally running AI models such as Ollama, giving you direct control over your development environment and project context.

## ✨ Core Features

* **🦙 Local AI Support:** Connects directly to local engines like Ollama running coding models such as `qwen3-coder:30b`.
* **🗺️ Project Structure Mapping:** Generates a `project_blueprint.md` project overview to give the AI a high-level understanding of the project's structure.
* **🕸️ Knowledge Graph & Visualization:** Analyzes source-file relationships such as imports and dependencies, generates a local `.freecoder/knowledge-graph.json`, and provides an interactive visual representation of the project's architecture.
* **🤖 AI Coding Agent:** Communicate directly with the currently active file or related project files. The Agent analyzes project context, creates a change plan, generates proposed file modifications, opens a VS Code diff for review, and applies approved changes through VS Code's workspace editing APIs.
* **🎯 Active File Context:** Automatically understands the file currently open in the VS Code editor, including the selected code when relevant.
* **🔎 Project Reference Analysis:** Searches relevant project source, test, and configuration files to identify references when handling project-wide requests such as renaming or replacing a symbol.
* **📋 Plan & Diff Review:** Separates planning from execution. Review the Agent's proposed plan first, then review the generated code changes in a VS Code diff before applying them.
* **🛑 Execution Interruption:** Stop normal AI generation with **Stop AI** or interrupt active Agent AI processing with **Stop Agent**.
* **⏳ Real-time Token Streaming:** Watch normal AI responses generate instantly token-by-token instead of waiting for the complete response.
* **📁 Smart Code Viewports:** Code snippets are isolated into independent windows with compact scrollable code areas and custom scrollbars.
* **📎 Clipboard Copy Actions:** Quick **Copy** actions are automatically attached to generated code blocks.
* **🔒 Multi-Tab State Persistence:** Your text, active chat history, and sidebar position are preserved when switching extension views.

## 🧠 Project Analysis, Mapping & Knowledge Graph

FreeCoder uses a technology-agnostic project analysis layer as the foundation for its project map, knowledge graph, and Agent context.

The architecture is designed to support different project types and frameworks, including:

* React / JavaScript / TypeScript
* Next.js 13 / 14 / 15
* PHP
* Laravel
* Other frameworks and languages in the future

### 🔍 Project Analysis Flow

```text
User Action
    │
    ├── Generate Project Map
    │
    ├── Generate Knowledge Graph
    │
    └── Use AI Agent
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
          /      |       \
         /       |        \
        ▼        ▼         ▼
 Project Map   Graph      Agent Context
    │           │             │
    ▼           ▼             ▼
project-     knowledge-    Active File
map.md       graph.json    Related Files
                           Project References

The project analysis layer keeps project discovery separate from the individual features that consume the resulting information.

🗺️ Project Structure Map

The Project Structure Map creates a human-readable overview of the opened project.

The generated project overview provides information such as:

Project type and detected framework
Programming languages and technologies
Relevant project directories
Source files
Configuration files
Tests
Assets
Entry points

The purpose of the project map is to answer:

"What does this project look like?"

Example:

src/
├── app/
│   ├── components/
│   │   ├── Header/
│   │   ├── TodoItem/
│   │   ├── TodoList/
│   │   └── AddTodo/
│   ├── layout.tsx
│   └── page.tsx
│
├── types/
│   └── Todo.ts
│
├── next.config.js
├── package.json
└── tsconfig.json

The map is intended to provide high-level project awareness rather than expose build output, dependency folders, and generated cache files.

🕸️ Knowledge Graph

The Knowledge Graph represents relationships between relevant source files.

The current graph focuses primarily on source-file relationships such as:

File
 │
 └── imports ──> File

For example:

src/app/page.tsx
       │
       ├── imports ──> components/Header/Header.tsx
       │
       ├── imports ──> components/TodoList/TodoList.tsx
       │
       └── imports ──> types/Todo.ts

The generated graph is stored locally at:

.freecoder/
└── knowledge-graph.json

The graph can be opened in a dedicated VS Code visualization to explore project relationships.

The Knowledge Graph answers:

"How are the parts of this project connected?"

🤖 AI Coding Agent

The AI Agent is designed to let you communicate directly with the file you are currently working on or with relevant parts of the project.

Instead of manually attaching files to every request, FreeCoder can use:

The active VS Code file
Selected code
Related files discovered through the Knowledge Graph
Project analysis
Project-wide symbol references
The user's instruction

The Agent workflow is intentionally separated into reviewable stages.

User Request
      │
      ▼
Active File / Project Context
      │
      ▼
Project Analysis
      │
      ├── Current File
      ├── Related Files
      ├── Project References
      └── Knowledge Graph
      │
      ▼
AI Agent Planner
      │
      ▼
Agent Plan
      │
      │ User reviews
      ▼
Generate Changes
      │
      ▼
AI Change Generator
      │
      ▼
VS Code Diff
      │
      │ User reviews
      ▼
Apply All Changes
      │
      ▼
VS Code WorkspaceEdit
      │
      ▼
Project Analysis Refresh

This gives the user control over every modification step.

The Agent does not directly write files while generating its plan.

📋 Agent Plan & Change Review

Agent modifications use two separate review stages.

1. Plan Review

The Agent first explains:

🧠 Agent Plan

Header.tsx
modify — Add buttonClickHandle implementation

[Generate Changes] [Cancel]

At this stage no project files have been modified.

2. Code Change Review

After the plan is approved, FreeCoder asks the AI to generate the exact proposed file contents and opens the resulting changes in the VS Code diff editor.

🔍 Review Changes

The proposed changes are open in the VS Code diff editor.

[Apply All Changes] [Cancel]

Only after the user selects Apply All Changes are the modifications applied using VS Code's workspace editing APIs.

🛑 Agent Interruption

Normal AI generation and Agent execution use separate cancellation controls.

Normal Chat
    │
    └── Stop AI ⏹️

Agent
    │
    └── Stop Agent ⏹️

Stopping Agent processing prevents an in-progress AI planning or change-generation operation from continuing.

Once the user reaches the final file-application stage, changes are handled through the controlled VS Code workspace editing process.

🔎 Project-Wide Context

For project-wide instructions such as:

Rename TodoList to TodoCollection everywhere.

FreeCoder can search relevant source, test, and configuration files for references to the requested identifier.

This allows the Agent to identify candidate files beyond the currently active file.

The intended workflow is:

User Request
     │
     ▼
Find Project References
     │
     ├── Source files
     ├── Tests
     └── Relevant configuration
     │
     ▼
Agent Plan
     │
     ▼
Target Files

This project-wide reference layer works alongside the Knowledge Graph rather than replacing it.

🤖 Why Project Map, Knowledge Graph & Agent Are All Useful

Each feature provides a different level of project understanding.

Capability	Project Map	Knowledge Graph	AI Agent
Directory structure	✅	Optional	✅
File inventory	✅	✅	✅
Human-readable overview	✅	❌	✅
AI project context	✅	✅	✅
Import relationships	❌	✅	✅
Dependency relationships	❌	✅	✅
Project-wide references	❌	❌	✅
Interactive visualization	❌	✅	❌
Plan file changes	❌	❌	✅
Review generated changes	❌	❌	✅
Apply file modifications	❌	❌	✅
Architecture exploration	Basic	Advanced	Advanced

Together:

Project Map
     ↓
"What exists?"

Knowledge Graph
     ↓
"How is it connected?"

AI Agent
     ↓
"What should I change and how?"
🛠️ Requirements & Setup

Before running this extension, make sure you configure your background AI engine.

1. Local Ollama Integration (Default)
Download and install Ollama.

Pull the target coding model:

ollama pull qwen3-coder:30b
Keep the Ollama application/background server running while using FreeCoder.

The current Agent planning and code-change generation pipeline uses the local Ollama model.

2. Multi-Modal Assets (Gemini / Free API)
The provider selector includes Gemini Flash and Hugging Face API options.
Image/file upload support is available in the UI.
Multi-modal online-provider functionality is still under development.
3. Package the Extension

After verifying the extension, create the VSIX package using:

vsce package --allow-missing-repository
🚀 How To Use
Click on the Speech Bubble Icon in your VS Code left sidebar panel.
Select your active backend model inside the AI Provider Tool dropdown.
Use 🗺️ Map to generate the project overview, or 🕸️ Graph to analyze source-file relationships and open the architecture visualization.
For normal AI assistance, enter your question or coding request and click Generate 🚀.
For file/project modifications, open the relevant file in VS Code, enter your requested change, and click Agent ✏️.
The Agent analyzes the active file and relevant project context, then displays an Agent Plan.
Review the plan and click Generate Changes.
Review the generated changes in the VS Code diff editor.
Click Apply All Changes to apply the approved modifications.
Use Stop AI ⏹️ to stop normal AI generation or Stop Agent ⏹️ to interrupt Agent processing.
Click 🗑️ Clear to clear the current chat history and start a fresh conversation session.
🧪 Example Agent Workflow

Suppose the currently opened file contains:

export default function Header({
    title
}: {
    title: string
}) {
    return (
        <>
            <h1>{title}</h1>

            <button
                id="modify-btn"
                onClick={buttonClickHandle}
            >
                Text
            </button>
        </>
    );
}

You can enter:

Implement buttonClickHandle in this file so clicking the Text button displays an alert saying "Button clicked".

Then:

Agent ✏️
    ↓
🧠 Agent Plan
    ↓
Generate Changes
    ↓
VS Code Diff
    ↓
Apply All Changes

FreeCoder can then generate a proposed implementation such as:

const buttonClickHandle = () => {
    alert("Button clicked");
};

The generated change is shown for review before it is applied to the workspace.

📦 How to Install From File (.VSIX)

If this extension was shared with you privately as a standalone bundle file:

Open VS Code and navigate to the Extensions tab (Ctrl+Shift+X or Cmd+Shift+X).
Click the three dots (...) button positioned in the top-right corner of the Extensions panel.
Choose Install from VSIX... from the dropdown.
Select the freecoder-0.0.1.vsix file from your local disk and open it.
Reload VS Code if requested.
🚧 Current Development Direction

FreeCoder is being developed toward a project-aware coding agent rather than a simple chat assistant.

The current foundation is:

Chat
  │
  ▼
Project Analysis
  │
  ├── Project Map
  ├── Knowledge Graph
  └── Agent Context
          │
          ▼
      AI Agent
          │
          ▼
      Plan
          │
          ▼
    Code Changes
          │
          ▼
       Diff
          │
          ▼
       Apply

Planned improvements include richer symbol-level knowledge graphs, safer file/directory rename operations, stronger multi-file refactoring, automated validation after changes, and improved diff lifecycle management.
```
