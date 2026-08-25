import * as vscode from "vscode";
import * as path from "path";
import { getChatHtml } from "./chatHtml";
import { generateKnowledgeGraph } from "./projectAnalysis/knowledgeGraph/graphGenerator";
import { showKnowledgeGraph } from "./projectAnalysis/knowledgeGraph/graphView";
import { analyzeProject } from "./projectAnalysis/projectAnalyzer";
import { generateProjectMap } from "./projectAnalysis/mappers/genericMapper";
import { getWorkspaceRoot } from "./projectAnalysis/workspace";
import {
  buildProjectContext,
  formatProjectContextForAI,
} from "./projectContext/contextEngine";
import { loadKnowledgeGraph } from "./projectAnalysis/knowledgeGraph/graphStorage";
import { AgentTask } from "./agent/types";
import { runAgentTask } from "./agent/agent";
import { generateFileChanges } from "./agent/changeGenerator";
import { closeAgentDiffs, showAgentDiffs } from "./agent/diffPreview";
import { applyFileChanges } from "./agent/applyChanges";

export function activate(context: vscode.ExtensionContext) {
  // Register Workspace Map Core Action Command
  const mapCmd = vscode.commands.registerCommand(
    "freeCopilot.generateProjectMap",
    async () => {
      const rootPath = getWorkspaceRoot();
      if (!rootPath) {
        vscode.window.showErrorMessage(
          "Please open a workspace project first!",
        );
        return;
      }
      try {
        const analysis = await analyzeProject(rootPath);
        await generateProjectMap(rootPath, analysis);
        vscode.window.showInformationMessage("Project Overview generated.");
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Project mapping failed: ${error?.message ?? "Unknown error"}`,
        );
      }
    },
  );
  const graphCmd = vscode.commands.registerCommand(
    "freeCopilot.generateKnowledgeGraph",
    async () => {
      const rootPath = getWorkspaceRoot();
      if (!rootPath) {
        vscode.window.showErrorMessage(
          "Please open a workspace project first!",
        );
        return;
      }
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
          `Knowledge graph generation failed: ${error.message}`,
        );
      }
    },
  );
  context.subscriptions.push(mapCmd, graphCmd);

  // Register Webview View Sidebar Provider Container interface
  const chatProvider = new FreeCopilotViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "freeCopilot.chatView",
      chatProvider,
      // 🔥 THE FIX: Pass the property here during registration so it binds to the sidebar lifecycle
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );
}

class FreeCopilotViewProvider implements vscode.WebviewViewProvider {
  // 1. Maintain a reference to the active AbortController to stop network streams
  private _activeAbortController: AbortController | null = null;
  private _agentAbortController: AbortController | null = null;
  private _webviewView: vscode.WebviewView | undefined;
  private _currentTask: AgentTask | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._webviewView = webviewView;
    // Keep it clean. Only assign basic options to the underlying webview document
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.description = "Local Code Assistant";
    webviewView.webview.html = getChatHtml("");

    // Intercept incoming interface pipeline events
    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log(
            "FreeCopilot WebView message:",
            data.command,
            data
        );
      switch (data.command) {
        case "generateMap": {
          const rootPath = getWorkspaceRoot();
          if (!rootPath) {
            break;
          }
          try {
            const analysis = await analyzeProject(rootPath);
            await generateProjectMap(rootPath, analysis);
            vscode.window.showInformationMessage("Project Overview generated.");
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Project mapping failed: ${error.message}`,
            );
          }
          break;
        }
        case "generateKnowledgeGraph": {
          const rootPath = getWorkspaceRoot();
          if (!rootPath) {
            break;
          }
          try {
            const analysis = await analyzeProject(rootPath);
            const graph = await generateKnowledgeGraph(analysis);
            if (graph) {
              showKnowledgeGraph(this._extensionUri, graph);
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Knowledge graph generation failed: ${error.message}`,
            );
          }
          break;
        }
        case "agentRequest": {
          console.log(
              "AGENT REQUEST CASE HIT:",
              data.message
          );
          const instruction =
            typeof data.message === "string" ? data.message.trim() : "";
          if (!instruction) {
            break;
          }
          await this.handleAgentRequest(instruction);
          break;
        }
        case "generateAgentChanges":
          await this.generateAgentChanges();
          break;
        case "applyAgentTask":
          await this.applyAgentTask();
          break;
        case "cancelAgentTask":
          this.cancelAgentTask();
          break;
        case "sendMessage":
          console.log("SEND MESSAGE CASE HIT");
          await this.handleChatMessage(data, webviewView);
          break;
        case "stopGeneration":
          if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
          }
          break;
        case "stopAgent":
          this.stopAgent();
          break;
        case "requestClearConfirmation": {
          const selection = await vscode.window.showWarningMessage(
            "Are you sure you want to clear your entire chat history log?",
            { modal: true }, // 'modal: true' makes it an overlay popup that prevents accidental misclicks
            "Yes, Clear Everything",
          );

          // If the user explicitly selects the clear confirmation selection trigger, message the frontend to sweep
          if (selection === "Yes, Clear Everything") {
            webviewView.webview.postMessage({
              command: "executeConfirmedClear",
            });
          }
          break;
        }
      }
    });
  }

  private async generateAgentChanges(): Promise<void> {
    if (!this._currentTask) {
      vscode.window.showWarningMessage("There is no pending agent task.");
      return;
    }
    if (this._currentTask.status !== "review") {
      return;
    }

    const rootPath = getWorkspaceRoot();

    if (!rootPath) {
      return;
    }

    try {
      this._agentAbortController = new AbortController();
      this._currentTask.status = "generating";
      this._webviewView?.webview.postMessage({command: "agentPlanAccepted"});

      // this._webviewView?.show(true);

      // STEP 5
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "changes",
        text: "Generating the actual file changes...",
      });

      const changes = await generateFileChanges(this._currentTask, rootPath, this._agentAbortController.signal);

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      this._currentTask.changes = changes;

      this._currentTask.status = "diff";

      // STEP 6
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "diff",
        text: "Opening the proposed changes in VS Code...",
      });

      await showAgentDiffs(rootPath, changes);

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      // The diff is now open.
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "diffApproval",
        text: "Review the diff before applying changes.",
      });

      this._webviewView?.webview.postMessage({
        command: "agentAwaitingApply",
        changes: changes.map(function(change) {
          return {
            path: change.path,
            operation: change.operation,
            explanation: change.explanation
          };
        })
      });
    } catch (error: any) {
      if (error && error?.name === "AbortError") {
        return;
      }
      const message = error?.message ?? "Unknown error while generating changes.";

      if (this._currentTask) {
        this._currentTask.status = "failed";
      }

      this._webviewView?.webview.postMessage({
        command: "agentExecutionFailed",
        text: message,
      });

      vscode.window.showErrorMessage(
        `Agent change generation failed: ${message}`,
      );
    } finally {
      this._agentAbortController = null;
    }
  }

  private async applyAgentTask(): Promise<void> {
    if (!this._currentTask) {
      vscode.window.showWarningMessage("There is no pending agent task.");

      return;
    }

    const rootPath = getWorkspaceRoot();

    if (!rootPath) {
      return;
    }

    const task = this._currentTask;

    if (task.status !== "diff") {
      vscode.window.showWarningMessage(
        "No reviewed changes are ready to apply.",
      );

      return;
    }

    if (task.changes.length === 0) {
      vscode.window.showWarningMessage("The agent generated no file changes.");

      return;
    }

    try {
      task.status = "applying";

      this._webviewView?.show(true);

      // STEP 7
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "applying",
        text: "Applying approved changes...",
      });

      this._webviewView?.webview.postMessage({
        command: "agentApplyingChanges",
      });

      await applyFileChanges(rootPath, task.changes);

      await closeAgentDiffs();

      task.status = "completed";

      await this.refreshProjectAnalysis();

      this._currentTask = task;

      // STEP 8
      this._webviewView?.webview.postMessage({
        command: "agentExecutionCompleted",

        changes: task.changes.map((change) => ({
          path: change.path,

          operation: change.operation,
        })),
      });

      vscode.window.showInformationMessage(
        `FreeCopilot successfully applied ${task.changes.length} change${
          task.changes.length === 1 ? "" : "s"
        }.`,
      );
    } catch (error: any) {
      task.status = "failed";

      const message = error?.message ?? "Unknown error while applying changes.";

      this._currentTask = task;

      this._webviewView?.webview.postMessage({
        command: "agentExecutionFailed",

        text: message,
      });

      vscode.window.showErrorMessage(
        `Agent could not apply changes: ${message}`,
      );
    }
  }

  private async cancelAgentTask(): Promise<void> {
    if (!this._currentTask) {
      return;
    }
    this._currentTask.status = "cancelled";
    await closeAgentDiffs();
    this._currentTask = undefined;
    this._webviewView?.webview.postMessage({
      command: "agentExecutionCancelled",
    });
  }

  // Fully converted to real-time NDJSON chunk stream handling with Abort Signal integration
  private async handleChatMessage(data: any, webviewView: vscode.WebviewView) {
    const { text, provider, attachment, attachmentType } = data;

    // Block multi-modal payloads from dropping into local textual models
    if (attachment && attachmentType?.startsWith("image/")) {
      if (provider === "ollama-qwen3-local") {
        webviewView.webview.postMessage({
          command: "showError",
          text: "Local Ollama Error: qwen3-coder:30b is a text model and does not support image uploads.",
        });
        return;
      }
    }

    // Check for file attachments first (Always processed if present)
    let attachedFileContext = "";
    const hasFileAttachment =
      attachment && !attachmentType?.startsWith("image/");
    if (hasFileAttachment) {
      attachedFileContext = `\n\n[USER ATTACHED FILE CONTEXT]\n\`\`\`\n${attachment}\n\`\`\``;
    }

    const rootPath = getWorkspaceRoot();
    let projectContextText = "";
    if (rootPath) {
      try {
        const analysis = await analyzeProject(rootPath);
        const graph = await loadKnowledgeGraph(rootPath);
        const projectContext = await buildProjectContext({
          rootPath,
          instruction: text,
          analysis,
          graph,
        });
        projectContextText = formatProjectContextForAI(projectContext);
      } catch (error) {
        console.error("Failed to build project context:", error);
      }
    }

    let finalPromptWithContext =
      text + attachedFileContext + projectContextText;

    // Fire initialization container command to HTML frontend UI
    webviewView.webview.postMessage({
      command: "startStream",
      provider: "Qwen3-Coder",
    });

    this._activeAbortController = new AbortController();

    try {
      if (provider === "ollama-qwen3-local") {
        const OLLAMA_URL = "http://localhost:11434/api/chat";

        // Update the System Prompt to guide the model on how to behave with or without context or attachment
        // let systemMessage = "You are an expert programming tutor and developer assistant.";
        let systemMessage = [
          "You are Free Copilot, an expert software engineering assistant.",
          "",
          "You are running inside VS Code.",
          "",
          "The user may ask questions about the currently active file,",
          "selected code, related files, or the entire project.",
          "",
          "Use the provided project context to understand relationships",
          "between files before answering.",
          "",
          "When the user asks for an explanation, explain the code clearly.",
          "",
          "When the user asks for a modification, do not pretend that",
          "you changed files unless an agent execution step actually",
          "performed the modification.",
          "",
          "When context is provided, prefer it over assumptions.",
        ].join("\n");

        // if (hasFileAttachment && needsProjectTreeMap) {
        //     systemMessage = "You are an expert workspace AI assistant. You have full context of the uploaded file AND the developer's project directory tree map layout.";
        // } else if (hasFileAttachment) {
        //     systemMessage = "You are an expert programming assistant. Analyze the specific file context attached by the user to answer their question directly.";
        // } else if (needsProjectTreeMap) {
        //     systemMessage = "You are an expert architectural AI assistant. Review the provided workspace folder map blueprint to guide the user.";
        // }

        const payload = {
          model: "qwen3-coder:30b",
          messages: [
            {
              role: "system",
              content: systemMessage,
            },
            {
              role: "user",
              content: finalPromptWithContext,
            },
          ],
          stream: true,
        };

        const response = await fetch(OLLAMA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: this._activeAbortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error(
            "Could not initialize network response text stream reader.",
          );
        }

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim() === "") {
              continue;
            }

            try {
              const parsedChunk = JSON.parse(line);
              const tokenText = parsedChunk.message?.content || "";

              if (tokenText) {
                webviewView.webview.postMessage({
                  command: "appendStream",
                  text: tokenText,
                });
              }
            } catch (e) {}
          }
        }

        webviewView.webview.postMessage({ command: "endStream" });
      } else {
        webviewView.webview.postMessage({
          command: "appendStream",
          text: `🤖 Simulating legacy fallback processing for alternative engine option type: ${provider}`,
        });
        webviewView.webview.postMessage({ command: "endStream" });
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Ollama stream generation aborted by the user.");
      } else {
        webviewView.webview.postMessage({
          command: "showError",
          text: `Ollama Connection Error: Failed to talk to local engine. Details: ${error.message}`,
        });
      }
    } finally {
      this._activeAbortController = null;
    }
  }

  private async handleAgentRequest(instruction: string): Promise<void> {
    const rootPath = getWorkspaceRoot();

    if (!rootPath) {
      return;
    }

    try {
      this._agentAbortController = new AbortController();
      this._webviewView?.show(true);

      // STEP 1
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "planning",
        text: "Understanding your request...",
      });

      const analysis = await analyzeProject(rootPath);

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      let graph = await loadKnowledgeGraph(rootPath);

      // STEP 2
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "context",
        text: "Reviewing current file and related files...",
      });

      graph ??= await generateKnowledgeGraph(analysis);

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      // STEP 3
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "plan",
        text: "Creating the agent plan...",
      });

      const task = await runAgentTask(instruction, rootPath, graph, analysis, this._agentAbortController.signal);

      if (this._agentAbortController.signal.aborted) {
        return;
      }
      this._currentTask = task;

      // STEP 4
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "planApproval",
        text: "Review the proposed plan.",
      });

      this._webviewView?.webview.postMessage({
        command: "agentPlan",
        plan: task,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return;
      }

      const message = error?.message ?? "Unknown agent error.";

      this._webviewView?.webview.postMessage({
        command: "agentExecutionFailed",
        text: message,
      });

      vscode.window.showErrorMessage(`Agent failed: ${message}`);
    } finally {
      this._agentAbortController = null;
    }
  }

  private async refreshProjectAnalysis(): Promise<void> {
    const rootPath = getWorkspaceRoot();
    if (!rootPath) {
      return;
    }
    try {
      const analysis = await analyzeProject(rootPath);
      await generateProjectMap(rootPath, analysis);
      await generateKnowledgeGraph(analysis);
    } catch (error: any) {
      console.error("FreeCopilot project analysis refresh failed:", error);
    }
  }

  private stopAgent(): void {
    if (this._agentAbortController) {
      this._agentAbortController.abort();
      this._agentAbortController = null;
    }
    if (this._currentTask) {
      this._currentTask.status = "cancelled";
    }
    this._webviewView?.webview.postMessage({command: "agentExecutionCancelled"});
  }
}

export function deactivate() {}
