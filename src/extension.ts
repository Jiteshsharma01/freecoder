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
import {
  applyFileChanges,
  captureAppliedSnapshots,
  verifyChangesCanBeUndone,
} from "./agent/applyChanges";
import {
  FREECOPILOT_DIFF_SCHEME,
  FreeCopilotDiffProvider,
} from "./agent/virtualDiffProvider";
import { ProjectAnalysis } from "./projectAnalysis/types";
import { validateProject } from "./agent/validator";

export function activate(context: vscode.ExtensionContext) {
  const diffProvider = new FreeCopilotDiffProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      FREECOPILOT_DIFF_SCHEME,
      diffProvider,
    ),
  );
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
  const chatProvider = new FreeCopilotViewProvider(
    context.extensionUri,
    diffProvider,
  );
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

function looksLikeExplicitPath(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function extractDeleteTarget(instruction: string): string | null {
  /*
   * Explicit:
   * Remove file src/utils/logger.ts
   * Delete file testFile.tsx
   */
  const explicitFileMatch = instruction.match(
    /\b(?:remove|delete|erase)\s+(?:the\s+)?(?:file|folder|directory)\s+[`"']?([A-Za-z0-9_$./\\-]+)[`"']?/i,
  );
  if (explicitFileMatch?.[1]) {
    return explicitFileMatch[1].trim();
  }
  /*
   * Filename-only:
   * Remove testFile.tsx
   * Delete logger.ts
   */
  const filenameMatch = instruction.match(
    /\b(?:remove|delete|erase)\s+[`"']?([A-Za-z0-9_$-]+\.[A-Za-z0-9_-]+)[`"']?/i,
  );
  if (filenameMatch?.[1]) {
    return filenameMatch[1].trim();
  }
  return null;
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function resolveDeleteCandidates(
  instruction: string,
  analysis: ProjectAnalysis,
): {
  requestedName: string;
  matches: string[];
} | null {
  const requestedName = extractDeleteTarget(instruction);

  if (!requestedName) {
    return null;
  }

  const normalizedRequest = normalizeWorkspacePath(requestedName);

  /*
   * ---------------------------------------------------------
   * Explicit path
   *
   * Example:
   *
   * Remove src/utils/testFile.tsx
   *
   * In this situation don't search by filename.
   * ---------------------------------------------------------
   */
  if (looksLikeExplicitPath(normalizedRequest)) {
    const exactMatch = analysis.files.find(
      (file) => normalizeWorkspacePath(file.path) === normalizedRequest,
    );

    return {
      requestedName,
      matches: exactMatch ? [normalizeWorkspacePath(exactMatch.path)] : [],
    };
  }

  /*
   * ---------------------------------------------------------
   * Filename-only request
   *
   * Example:
   *
   * Remove testFile.tsx
   *
   * Search the complete ProjectAnalysis instead of
   * allowing Qwen to guess which file was intended.
   * ---------------------------------------------------------
   */
  const normalizedName = requestedName.toLowerCase().trim();

  const matches = analysis.files
    .filter((file) => file.name.toLowerCase().trim() === normalizedName)
    .map((file) => normalizeWorkspacePath(file.path))
    .filter((filePath, index, all) => all.indexOf(filePath) === index);

  return {
    requestedName,
    matches,
  };
}

function resolveSafePathForUndo(
  rootPath: string,
  relativePath: string,
): string {
  /*
   * Never allow the Agent to use an absolute path.
   */
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  /*
   * Resolve the path against the workspace root.
   */
  const absolutePath = path.resolve(rootPath, relativePath);

  /*
   * Calculate the path back from workspace root.
   */
  const relativeFromRoot = path.relative(rootPath, absolutePath);

  /*
   * If the path starts with ".." or becomes absolute,
   * it escaped the workspace.
   */
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return absolutePath;
}

function shouldUseProjectContext(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  // EXPLICIT PROJECT / FILE CONTEXT. These phrases clearly indicate that the user wants FreeCopilot to understand their workspace/code.
  const projectIndicators = [
    "my project",
    "this project",
    "in my project",
    "in this project",
    "my code",
    "this code",
    "in my code",
    "in this code",
    "my app",
    "this app",
    "in my app",
    "in this app",
    "my repository",
    "this repository",
    "my workspace",
    "this workspace",
    "project structure",
    "project architecture",
    "project files",
    "this file",
    "this component",
    "this function",
    "this class",
    "my component",
    "my function",
    "my class",
  ];
  if (projectIndicators.some((indicator) => normalized.includes(indicator))) {
    return true;
  }
  // PROJECT-SPECIFIC ACTIONS
  const projectActions = [
    "fix this",
    "fix my",
    "modify this",
    "modify my",
    "change this",
    "change my",
    "update this",
    "update my",
    "refactor this",
    "refactor my",
    "debug this",
    "debug my",
    "implement this",
    "implement in this",
    "where is this used",
    "where is it used",
    "find this in the project",
    "find all references",
    "all references",
    "all usages",
    "all occurrences",
    "everywhere",
  ];
  if (projectActions.some((indicator) => normalized.includes(indicator))) {
    return true;
  }
  return false;
}

export function isFileDeletionRequest(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  /*
   * Explicit filesystem deletion language.
   *
   * Examples:
   *
   * remove file logger.ts
   * delete file test.tsx
   * erase file config.json
   */
  if (
    /\b(?:remove|delete|erase)\s+(?:the\s+)?(?:file|folder|directory)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  /*
   * Filename-based deletion.
   *
   * Examples:
   *
   * remove testFile.tsx
   * delete logger.ts
   *
   * This intentionally requires something that looks like
   * a filename rather than accepting "remove unused".
   */
  if (
    /\b(?:remove|delete|erase)\s+[`"']?[A-Za-z0-9_$.-]+\.[A-Za-z0-9_-]+[`"']?/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

class FreeCopilotViewProvider implements vscode.WebviewViewProvider {
  // 1. Maintain a reference to the active AbortController to stop network streams
  private _activeAbortController: AbortController | null = null;
  private _agentAbortController: AbortController | null = null;
  private _webviewView: vscode.WebviewView | undefined;
  private _currentTask: AgentTask | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _diffProvider: FreeCopilotDiffProvider,
  ) {}

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
      console.log("FreeCopilot WebView message:", data.command, data);
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
          console.log("AGENT REQUEST CASE HIT:", data.message);
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
        case "undoAgentChanges":
          await this.undoAgentChanges();
          break;
        case "stopAgent":
          this.stopAgent();
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
    if (!this._currentTask || this._currentTask.status !== "review") {
      return;
    }

    const rootPath = getWorkspaceRoot();

    if (!rootPath) {
      return;
    }

    try {
      this._agentAbortController = new AbortController();
      this._currentTask.status = "generating";
      this._webviewView?.webview.postMessage({ command: "agentPlanAccepted" });

      // this._webviewView?.show(true);

      // STEP 5
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "changes",
        text: "Generating the actual file changes...",
      });

      const changes = await generateFileChanges(
        this._currentTask,
        rootPath,
        this._agentAbortController.signal,
      );

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

      await showAgentDiffs(rootPath, changes, this._diffProvider);

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
        changes: changes.map(function (change) {
          return {
            path: change.path,
            operation: change.operation,
            explanation: change.explanation,
          };
        }),
      });
    } catch (error: any) {
      if (error && error?.name === "AbortError") {
        return;
      }
      const message =
        error?.message ?? "Unknown error while generating changes.";

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

    /*
     * Apply is allowed only after the user has reviewed
     * the generated diff.
     */
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
      /*
       * ---------------------------------------------------------
       * STEP 1: APPLY
       * ---------------------------------------------------------
       */
      task.status = "applying";

      this._webviewView?.show(true);

      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "applying",
        text: "Applying approved changes...",
      });

      this._webviewView?.webview.postMessage({
        command: "agentApplyingChanges",
      });

      await applyFileChanges(rootPath, task.changes);
      await captureAppliedSnapshots(rootPath, task.changes);
      /*
       * Close the virtual diff only after the real workspace
       * edit has successfully been applied.
       */
      await closeAgentDiffs();
      /*
       * ---------------------------------------------------------
       * STEP 2: VALIDATION
       * ---------------------------------------------------------
       */
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "validation",
        text: "Changes applied. Validating the project...",
      });

      const validation = await validateProject(rootPath);

      /*
       * Refresh ProjectAnalysis / Knowledge Graph after
       * the actual workspace has changed.
       */
      await this.refreshProjectAnalysis();

      /*
       * The WorkspaceEdit succeeded, so the Agent task itself
       * is completed even if validation found problems.
       */
      task.status = "completed";
      this._currentTask = task;
      /*
       * Send validation details to the WebView.
       */
      this._webviewView?.webview.postMessage({
        command: "agentValidationResult",
        validation,
      });

      /*
       * Tell the WebView the entire Agent operation finished.
       */
      this._webviewView?.webview.postMessage({
        command: "agentExecutionCompleted",
        changes: task.changes.map((change) => ({
          path: change.path,
          operation: change.operation,
        })),
        validation,
      });

      /*
       * User-facing result.
       */
      if (validation.status === "failed") {
        vscode.window.showWarningMessage(
          [
            `FreeCopilot applied ${task.changes.length} change${
              task.changes.length === 1 ? "" : "s"
            }, but project validation found problems.`,
            "Review the validation results in the FreeCopilot panel.",
          ].join(" "),
        );
      } else if (validation.status === "skipped") {
        vscode.window.showInformationMessage(
          `FreeCopilot successfully applied ${task.changes.length} change${
            task.changes.length === 1 ? "" : "s"
          }. Project validation was skipped.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `FreeCopilot successfully applied ${task.changes.length} change${
            task.changes.length === 1 ? "" : "s"
          } and project validation passed.`,
        );
      }
    } catch (error: any) {
      /*
       * This catch represents an actual failure to apply the
       * changes, not a validation failure.
       */
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
    if (this._agentAbortController) {
      this._agentAbortController.abort();
      this._agentAbortController = null;
    }
    await closeAgentDiffs();
    if (this._currentTask) {
      this._currentTask.status = "cancelled";
    }
    this._currentTask = undefined;
    this._webviewView?.webview.postMessage({
      command: "agentExecutionCancelled",
    });
  }

  // Fully converted to real-time NDJSON chunk stream handling with Abort Signal integration
  private async handleChatMessage(data: any, webviewView: vscode.WebviewView) {
    const { text, provider, attachment, attachmentType } = data;
    // BLOCK UNSUPPORTED LOCAL IMAGE INPUT
    if (attachment && attachmentType?.startsWith("image/")) {
      if (provider === "ollama-qwen3-local") {
        webviewView.webview.postMessage({
          command: "showError",
          text: "Local Ollama Error: qwen3-coder:30b is a text model and does not support image uploads.",
        });
        return;
      }
    }

    // FILE ATTACHMENT CONTEXT
    let attachedFileContext = "";
    const hasFileAttachment = Boolean(attachment && !attachmentType?.startsWith("image/"));
    if (hasFileAttachment) {
      attachedFileContext = [
        "",
        "",
        "[USER ATTACHED FILE CONTEXT]",
        "```",
        attachment,
        "```",
      ].join("\n");
    }

    // DECIDE WHETHER NORMAL CHAT NEEDS PROJECT CONTEXT
    const needsProjectContext = shouldUseProjectContext(text);

    // BUILD PROJECT CONTEXT ONLY WHEN REQUIRED
    let projectContextText = "";

    if (needsProjectContext) {
      const rootPath = getWorkspaceRoot();
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
    }

    // FINAL PROMPT
    const finalPromptWithContext =
      text + attachedFileContext + projectContextText;

    // START STREAM UI
    webviewView.webview.postMessage({
      command: "startStream",
      provider: "Qwen3-Coder",
    });

    // NORMAL CHAT ABORT CONTROLLER
    this._activeAbortController = new AbortController();

    try {
      if (provider === "ollama-qwen3-local") {
        const OLLAMA_URL = "http://localhost:11434/api/chat";

        // NORMAL CHAT SYSTEM PROMPT
        const systemMessage = [
          "You are Free Copilot, an expert software engineering assistant.",
          "",
          "You are running inside VS Code.",
          "",
          "The user may ask general programming questions or",
          "questions about the currently active file, selected code,",
          "related files, or the entire project.",
          "",
          "Project context is only provided when the request clearly",
          "requires understanding the user's workspace or code.",
          "",
          "When project context is provided, use it to understand",
          "relationships between files before answering.",
          "",
          "When no project context is provided, answer the user's",
          "question using your general programming knowledge and",
          "the explicitly supplied attachment context.",
          "",
          "When the user asks for an explanation, explain the code clearly.",
          "",
          "When the user asks for a modification, do not pretend that",
          "you changed files unless an agent execution step actually",
          "performed the modification.",
          "",
          "When context is provided, prefer it over assumptions.",
        ].join("\n");

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

        // OLLAMA REQUEST
        const response = await fetch(OLLAMA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: this._activeAbortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        // STREAM READER
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) {
          throw new Error(
            "Could not initialize network response text stream reader.",
          );
        }

        let buffer = "";
        // READ NDJSON STREAM
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
            } catch {}
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
      if (error?.name === "AbortError") {
        console.log("Ollama stream generation aborted by the user.");
      } else {
        webviewView.webview.postMessage({
          command: "showError",
          text: `Ollama Connection Error: Failed to talk to local engine. Details: ${
            error?.message ?? "Unknown error"
          }`,
        });
      }
    } finally {
      this._activeAbortController = null;
    }
  }

  private async handleAgentRequest(instruction: string): Promise<void> {
    /*
     * ---------------------------------------------------------
     * 1. Prevent concurrent Agent tasks.
     * ---------------------------------------------------------
     */
    if (this.isAgentBusy()) {
      vscode.window.showWarningMessage(
        "A FreeCopilot Agent task is already in progress. Complete or cancel it before starting another Agent task.",
      );

      this._webviewView?.webview.postMessage({
        command: "agentBusy",

        text: "An Agent task is already running. Complete or cancel it before starting another one.",
      });

      return;
    }

    /*
     * ---------------------------------------------------------
     * 2. Prevent Agent from starting while normal AI chat is
     *    still running.
     *
     *    This is primarily a UI guard, but keeping this check
     *    in the extension host is safer.
     * ---------------------------------------------------------
     */
    if (this._activeAbortController) {
      vscode.window.showWarningMessage(
        "Please stop the current AI generation before starting an Agent task.",
      );

      this._webviewView?.webview.postMessage({
        command: "agentBusy",

        text: "Stop the current AI generation before starting an Agent task.",
      });

      return;
    }

    const rootPath = getWorkspaceRoot();

    if (!rootPath) {
      return;
    }

    /*
     * Keep the original user request untouched.
     * We will only append resolved workspace context.
     */
    let agentInstruction = instruction;

    try {
      /*
       * -------------------------------------------------------
       * 3. Start Agent cancellation controller.
       * -------------------------------------------------------
       */
      this._agentAbortController = new AbortController();

      /*
       * -------------------------------------------------------
       * 4. Initial Agent UI state.
       * -------------------------------------------------------
       */
      this._webviewView?.show(true);

      this._webviewView?.webview.postMessage({
        command: "agentProgress",

        stage: "planning",

        text: "Understanding your request...",
      });

      /*
       * -------------------------------------------------------
       * 5. Analyze project.
       * -------------------------------------------------------
       */
      const analysis = await analyzeProject(rootPath);

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 6. Resolve destructive DELETE requests before
       *    sending them to the LLM.
       *
       *    This is deterministic and prevents Qwen from
       *    choosing between multiple files with the same name.
       * -------------------------------------------------------
       */
      const isDeleteRequest = isFileDeletionRequest(instruction);

      if (isDeleteRequest) {
        const deleteResolution = resolveDeleteCandidates(instruction, analysis);

        if (deleteResolution?.matches.length === 0) {
          const message = `Could not find a file named "${deleteResolution.requestedName}" in the workspace.`;

          vscode.window.showWarningMessage(message);

          this._webviewView?.webview.postMessage({
            command: "agentExecutionFailed",
            text: message,
          });

          return;
        }

        if (deleteResolution && deleteResolution.matches.length > 1) {
          /*
           * Multiple files have the same filename.
           *
           * The user MUST decide which one is intended.
           */
          const selected = await vscode.window.showQuickPick(
            deleteResolution.matches,
            {
              title: `Multiple files named "${deleteResolution.requestedName}" were found`,
              placeHolder: "Select the file you want FreeCopilot to remove",
              ignoreFocusOut: true,
            },
          );

          /*
           * User closed the QuickPick.
           */
          if (!selected) {
            this._webviewView?.webview.postMessage({command: "agentExecutionCancelled"});
            return;
          }

          /*
           * Give the planner the exact path selected
           * by the user.
           */
          agentInstruction = [
            instruction,
            "",
            "================ RESOLVED DELETE TARGET ================",
            `The user explicitly selected this file for deletion: ${selected}`,
            "Use this exact workspace path.",
            "Do not select another file with the same filename.",
            "==========================================================",
          ].join("\n");
        } else if (deleteResolution && deleteResolution.matches.length === 1) {
          /*
           * One exact match.
           *
           * No dialog necessary.
           */
          const selected = deleteResolution.matches[0];

          agentInstruction = [
            instruction,
            "",
            "================ RESOLVED DELETE TARGET ================",
            `Resolved workspace file: ${selected}`,
            "Use this exact workspace path for the delete operation.",
            "==========================================================",
          ].join("\n");
        }
      }

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 7. Load existing graph.
       * -------------------------------------------------------
       */
      let graph = await loadKnowledgeGraph(rootPath);

      /*
       * -------------------------------------------------------
       * 8. Update progress.
       * -------------------------------------------------------
       */
      this._webviewView?.webview.postMessage({
        command: "agentProgress",

        stage: "context",

        text: "Reviewing current file and related files...",
      });

      /*
       * -------------------------------------------------------
       * 9. Generate graph if it doesn't exist.
       * -------------------------------------------------------
       */
      if (!graph) {
        graph = await generateKnowledgeGraph(analysis);
      }

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 10. Planning stage.
       * -------------------------------------------------------
       */
      this._webviewView?.webview.postMessage({
        command: "agentProgress",

        stage: "plan",

        text: "Creating the agent plan...",
      });

      const task = await runAgentTask(
        agentInstruction,
        rootPath,
        graph,
        analysis,
        this._agentAbortController.signal,
      );

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 11. Store the current task.
       * -------------------------------------------------------
       */
      this._currentTask = task;

      /*
       * -------------------------------------------------------
       * 12. Wait for user approval of the plan.
       * -------------------------------------------------------
       */
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
      /*
       * An AbortError is an expected cancellation.
       */
      if (error?.name === "AbortError") {
        return;
      }

      const message = error?.message ?? "Unknown Agent error.";

      this._webviewView?.webview.postMessage({
        command: "agentExecutionFailed",

        text: message,
      });

      vscode.window.showErrorMessage(`Agent failed: ${message}`);
    } finally {
      /*
       * Do NOT clear _currentTask here.
       *
       * The task is needed after the planner finishes so
       * Generate Changes can use it.
       */
      this._agentAbortController = null;
    }
  }

  private async undoAgentChanges(): Promise<void> {
    if (!this._currentTask) {
      vscode.window.showWarningMessage(
        "There is no completed Agent task to undo.",
      );
      return;
    }
    const task = this._currentTask;
    if (task.status !== "completed") {
      vscode.window.showWarningMessage(
        "Only a completed Agent task can be undone.",
      );
      return;
    }
    if (task.changes.length === 0) {
      vscode.window.showWarningMessage(
        "The completed Agent task contains no changes to undo.",
      );
      return;
    }
    const rootPath = getWorkspaceRoot();
    if (!rootPath) {
      return;
    }
    const selection = await vscode.window.showWarningMessage(
      "Undo all changes made by the last FreeCopilot Agent task?",
      {
        modal: true,
      },
      "Undo Changes",
    );
    if (selection !== "Undo Changes") {
      this._webviewView?.webview.postMessage({
        command: "agentUndoCancelled",
      });
      return;
    }

    try {
      /*
       * Verify that nobody has modified the workspace
       * after the Agent applied its changes.
       */
      await verifyChangesCanBeUndone(rootPath, task.changes);
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const change of task.changes) {
        const uri = vscode.Uri.file(
          resolveSafePathForUndo(rootPath, change.path),
        );
        switch (change.operation) {
          case "create": {
            /*
             * Agent created it.
             * Undo = delete it.
             */
            workspaceEdit.deleteFile(uri, {
              ignoreIfNotExists: false,
              recursive: false,
            });
            break;
          }

          case "modify": {
            if (change.originalContent === undefined) {
              throw new Error(
                `Cannot undo ${change.path}: original content is missing.`,
              );
            }
            const document = await vscode.workspace.openTextDocument(uri);
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length),
            );
            workspaceEdit.replace(uri, fullRange, change.originalContent);
            break;
          }

          case "delete": {
            if (change.originalContent === undefined) {
              throw new Error(
                `Cannot undo ${change.path}: original content is missing.`,
              );
            }
            workspaceEdit.createFile(uri, {
              overwrite: false,
              ignoreIfExists: false,
            });
            workspaceEdit.insert(
              uri,
              new vscode.Position(0, 0),
              change.originalContent,
            );
            break;
          }

          case "rename": {
            if (!change.originalPath || !change.newPath) {
              throw new Error(
                `Cannot undo rename ${change.path}: originalPath and newPath are required.`,
              );
            }
            const currentUri = vscode.Uri.file(
              resolveSafePathForUndo(rootPath, change.newPath),
            );
            const originalUri = vscode.Uri.file(
              resolveSafePathForUndo(rootPath, change.originalPath),
            );
            workspaceEdit.renameFile(currentUri, originalUri, {
              overwrite: false,
              ignoreIfExists: false,
            });
            break;
          }

          default:
            throw new Error(
              `Unsupported Agent undo operation: ${change.operation}`,
            );
        }
      }

      const applied = await vscode.workspace.applyEdit(workspaceEdit);
      if (!applied) {
        throw new Error("VS Code rejected the Agent undo operation.");
      }

      /*
       * Refresh project metadata after the workspace
       * has been restored.
       */
      await this.refreshProjectAnalysis();

      this._webviewView?.webview.postMessage({
        command: "agentChangesUndone",
      });

      vscode.window.showInformationMessage(
        `FreeCopilot successfully undid ${task.changes.length} change${
          task.changes.length === 1 ? "" : "s"
        }.`,
      );
    } catch (error: any) {
      const message =
        error?.message ?? "Unknown error while undoing Agent changes.";

      this._webviewView?.webview.postMessage({
        command: "agentUndoFailed",
        text: message,
      });

      vscode.window.showErrorMessage(
        `FreeCopilot could not undo the Agent changes: ${message}`,
      );
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

  private isAgentBusy(): boolean {
    if (!this._currentTask) {
      return false;
    }

    return (
      this._currentTask.status === "planning" ||
      this._currentTask.status === "review" ||
      this._currentTask.status === "generating" ||
      this._currentTask.status === "diff" ||
      this._currentTask.status === "applying"
    );
  }

  private async stopAgent(): Promise<void> {
    if (!this.isAgentBusy()) {
      return;
    }
    if (this._agentAbortController) {
      this._agentAbortController.abort();
      this._agentAbortController = null;
    }
    if (this._currentTask) {
      this._currentTask.status = "cancelled";
    }
    await closeAgentDiffs();
    this._currentTask = undefined;
    this._webviewView?.webview.postMessage({
      command: "agentExecutionCancelled",
    });
    vscode.window.showInformationMessage("FreeCopilot Agent stopped.");
  }
}

export function deactivate() {}
