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
import { AgentModelSnapshot, AgentTask } from "./agent/types";
import {
  createTaskId,
  determineScope,
  isAgentTask,
  runAgentTask,
} from "./agent/agent";
import { generateFileChanges } from "./agent/changeGenerator";
import { closeAgentDiffs, showAgentDiffs } from "./agent/diffPreview";
import {
  applyFileChanges,
  captureAppliedSnapshots,
  verifyChangesCanBeUndone,
} from "./agent/applyChanges";
import {
  FREECODER_DIFF_SCHEME,
  FreeCoderDiffProvider,
} from "./agent/virtualDiffProvider";
import { ProjectAnalysis } from "./projectAnalysis/types";
import { validateProject } from "./agent/validator";
import { isFileDeletionRequest } from "./agent/requestClassifier";
import { generateAgentPlan, resolveAgentRequest } from "./agent/taskPlanner";
import {
  buildAgentContext,
  buildAgentResolutionContext,
} from "./agent/contextBuilder";
import {
  addOllamaModelToConfig,
  ensureFreeCoderConfig,
  getFreeCoderModelId,
  loadFreeCoderConfig,
  listInstalledOllamaModels,
  validateOllamaModelAvailable,
  FREECODER_CONFIG_FILE,
  FreeCoderModel,
  getFreeCoderModelForRole,
} from "./config/modelConfig";
import {
  extractWorkspaceFileReferences,
  readWorkspaceContextFiles,
  formatWorkspaceFileContext,
} from "./utils/workspaceFileContext";

export function activate(context: vscode.ExtensionContext) {
  const diffProvider = new FreeCoderDiffProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      FREECODER_DIFF_SCHEME,
      diffProvider,
    ),
  );
  // Register Workspace Map Core Action Command
  const mapCmd = vscode.commands.registerCommand(
    "freeCoder.generateProjectMap",
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
    "freeCoder.generateKnowledgeGraph",
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
  const chatProvider = new FreeCoderViewProvider(
    context.extensionUri,
    diffProvider,
    context,
  );
  const configSaveListener = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      if (document.uri.fsPath !== FREECODER_CONFIG_FILE) {
        return;
      }
      await chatProvider.refreshConfiguredModels();
    },
  );

  context.subscriptions.push(configSaveListener);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "freeCoder.chatView",
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
  // EXPLICIT PROJECT / FILE CONTEXT. These phrases clearly indicate that the user wants FreeCoder to understand their workspace/code.
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

class FreeCoderViewProvider implements vscode.WebviewViewProvider {
  private static readonly SELECTED_MODEL_STATE_KEY =
    "freecoder.selectedModelId";
  private static readonly ACTIVE_CONFIG_STATE_KEY =
    "freecoder.activeConfigPath";
  // 1. Maintain a reference to the active AbortController to stop network streams
  private _activeAbortController: AbortController | null = null;
  private _agentAbortController: AbortController | null = null;
  private _webviewView: vscode.WebviewView | undefined;
  private _currentTask: AgentTask | undefined;
  private _pendingAgentClarificationInstruction: string | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _diffProvider: FreeCoderDiffProvider,
    private readonly _extensionContext: vscode.ExtensionContext,
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
    void this.sendConfiguredModels();

    // Intercept incoming interface pipeline events
    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log("FreeCoder WebView message:", data.command, data);
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
          const modelId =
            typeof data.modelId === "string" && data.modelId.trim()
              ? data.modelId.trim()
              : undefined;

          if (!instruction) {
            break;
          }
          this._pendingAgentClarificationInstruction = null;
          await this.handleAgentRequest(instruction, modelId);
          break;
        }
        case "agentClarificationSelected": {
          const clarificationInstruction =
            typeof data.instruction === "string" ? data.instruction.trim() : "";

          if (!clarificationInstruction) {
            break;
          }

          const originalInstruction =
            this._pendingAgentClarificationInstruction;
          this._pendingAgentClarificationInstruction = null;

          const combinedInstruction =
            originalInstruction &&
            !clarificationInstruction.includes(originalInstruction)
              ? [
                  "Original user request:",
                  originalInstruction,
                  "",
                  "User's clarification:",
                  clarificationInstruction,
                ].join("\n")
              : clarificationInstruction;

          await this.handleAgentRequest(combinedInstruction);
          break;
        }
        case "agentClarificationRewrite": {
          const rewrittenInstruction =
            typeof data.instruction === "string" ? data.instruction.trim() : "";
          if (!rewrittenInstruction) {
            break;
          }
          const modelId =
            typeof data.modelId === "string" && data.modelId.trim()
              ? data.modelId.trim()
              : undefined;
          this._pendingAgentClarificationInstruction = null;
          await this.handleAgentRequest(rewrittenInstruction, modelId);
          break;
        }
        case "openMainConfig": {
          await this.openMainConfig();
          break;
        }
        case "reloadConfig": {
          try {
            await this.sendConfiguredModels();
          } catch (error: any) {
            webviewView.webview.postMessage({
              command: "showError",
              text: error?.message ?? "Failed to reload configuration.",
            });
          }
          break;
        }
        case "discoverOllamaModels": {
          try {
            const installedModels = await listInstalledOllamaModels();
            const config = await loadFreeCoderConfig();
            const defaultApiBase = "http://localhost:11434";
            const models = installedModels.map((installedModel) => {
              const alreadyConfigured = config.models.some(
                (configuredModel) =>
                  configuredModel.provider.toLowerCase() === "ollama" &&
                  configuredModel.model === installedModel.name &&
                  (configuredModel.apiBase ?? defaultApiBase).replace(
                    /\/+$/,
                    "",
                  ) === defaultApiBase,
              );

              return {
                ...installedModel,
                alreadyConfigured,
              };
            });

            webviewView.webview.postMessage({
              command: "ollamaModelsDiscovered",
              models,
            });
          } catch (error: any) {
            webviewView.webview.postMessage({
              command: "showError",
              text: error?.message ?? "Failed to discover Ollama models.",
            });
          }

          break;
        }

        case "addOllamaModel": {
          const modelName =
            typeof data.modelName === "string" ? data.modelName.trim() : "";

          if (!modelName) {
            break;
          }

          try {
            const result = await addOllamaModelToConfig(modelName);

            webviewView.webview.postMessage({
              command: "ollamaModelAdded",
              modelName,
              added: result.added,
              message: result.added
                ? `Added "${modelName}" to Main Config. No roles were assigned.`
                : `"${modelName}" is already in Main Config.`,
            });

            if (result.added) {
              try {
                await this.sendConfiguredModels();
              } catch (refreshError: any) {
                webviewView.webview.postMessage({
                  command: "showError",
                  text:
                    `Model "${modelName}" was added, but the model list ` +
                    `could not be refreshed: ${
                      refreshError?.message ?? "Unknown error."
                    }`,
                });
              }
            }
          } catch (error: any) {
            webviewView.webview.postMessage({
              command: "showError",
              text:
                error?.message ??
                "Failed to add the Ollama model to Main Config.",
            });
          }

          break;
        }

        case "selectModel": {
          try {
            const modelId =
              typeof data.modelId === "string" ? data.modelId.trim() : "";

            if (!modelId) {
              break;
            }

            await this.selectModel(modelId);
          } catch (error: any) {
            webviewView.webview.postMessage({
              command: "showError",
              text: error?.message ?? "Failed to select the configured model.",
            });
          }

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

  private getActiveConfigPath(): string {
    return (
      this._extensionContext.globalState.get<string>(
        FreeCoderViewProvider.ACTIVE_CONFIG_STATE_KEY,
      ) ?? FREECODER_CONFIG_FILE
    );
  }

  private async openMainConfig(): Promise<void> {
    try {
      await ensureFreeCoderConfig();

      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(FREECODER_CONFIG_FILE),
      );

      await vscode.window.showTextDocument(document, {
        preview: false,
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open Main Config: ${error?.message ?? "Unknown error"}`,
      );
    }
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
        this._agentAbortController?.signal,
      );

      if (this._agentAbortController.signal.aborted) {
        return;
      }

      this._currentTask.changes = changes;
      this._currentTask.status = "diff";

      this._webviewView?.webview.postMessage({
        command: "agentResponse",
        changes: changes.map((change) => ({
          path: change.path,
          operation: change.operation,
          newContent: change.newContent,
          explanation: change.explanation,
        })),
      });

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
            `FreeCoder applied ${task.changes.length} change${
              task.changes.length === 1 ? "" : "s"
            }, but project validation found problems.`,
            "Review the validation results in the FreeCoder panel.",
          ].join(" "),
        );
      } else if (validation.status === "skipped") {
        vscode.window.showInformationMessage(
          `FreeCoder successfully applied ${task.changes.length} change${
            task.changes.length === 1 ? "" : "s"
          }. Project validation was skipped.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `FreeCoder successfully applied ${task.changes.length} change${
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

  private async getSelectedModel(
    role:
      | "chat"
      | "edit"
      | "apply"
      | "resolver"
      | "planner"
      | "changeGenerator"
      | "embed",
    requestedModelId?: string,
  ): Promise<FreeCoderModel> {
    const config = await loadFreeCoderConfig();

    const selectedModelId =
      requestedModelId ??
      this._extensionContext.globalState.get<string>(
        FreeCoderViewProvider.SELECTED_MODEL_STATE_KEY,
      );

    if (selectedModelId) {
      const selectedModel = config.models.find(
        (model) => getFreeCoderModelId(model) === selectedModelId,
      );

      if (selectedModel) {
        if (selectedModel.roles?.includes(role)) {
          return selectedModel;
        }

        throw new Error(
          `The selected model "${selectedModel.name}" does not support the "${role}" role.`,
        );
      }
    }

    const fallbackModel = config.models.find((model) =>
      model.roles?.includes(role),
    );

    if (!fallbackModel) {
      throw new Error(
        `No model is configured for the "${role}" role in ~/.freecoder/config.yaml.`,
      );
    }

    return fallbackModel;
  }

  private async selectModel(modelId: string): Promise<void> {
    const config = await loadFreeCoderConfig();

    const model = config.models.find(
      (item) => getFreeCoderModelId(item) === modelId,
    );

    if (!model) {
      // The requested model may have been removed during a reload.
      // Refresh the list and recover the saved Chat selection.
      await this.sendConfiguredModels();
      return;
    }

    await this._extensionContext.globalState.update(
      FreeCoderViewProvider.SELECTED_MODEL_STATE_KEY,
      modelId,
    );

    this._webviewView?.webview.postMessage({
      command: "modelSelected",
      model: {
        id: getFreeCoderModelId(model),
        name: model.name,
        provider: model.provider,
        model: model.model,
        roles: model.roles ?? [],
      },
    });
  }

  private async sendConfiguredModels(): Promise<void> {
    const activeConfigPath = this.getActiveConfigPath();
    const config = await loadFreeCoderConfig();

    const storedSelectedModelId =
      this._extensionContext.globalState.get<string>(
        FreeCoderViewProvider.SELECTED_MODEL_STATE_KEY,
      );

    const storedModel = config.models.find(
      (model) => getFreeCoderModelId(model) === storedSelectedModelId,
    );

    // The persisted selection is used by normal Chat,
    // so it must still support the "chat" role.
    const selectedModel = storedModel?.roles?.includes("chat")
      ? storedModel
      : config.models.find((model) => model.roles?.includes("chat"));

    if (!selectedModel) {
      throw new Error(
        'No model is configured for the "chat" role in ~/.freecoder/config.yaml.',
      );
    }

    const selectedModelId = getFreeCoderModelId(selectedModel);

    // Repair stale or role-incompatible saved selections.
    if (selectedModelId !== storedSelectedModelId) {
      await this._extensionContext.globalState.update(
        FreeCoderViewProvider.SELECTED_MODEL_STATE_KEY,
        selectedModelId,
      );
    }

    this._webviewView?.webview.postMessage({
      command: "configuredModels",
      selectedModelId,

      activeConfig: {
        name: config.name,
        fileName: path.basename(activeConfigPath),
        filePath: activeConfigPath,
      },

      models: config.models.map((model) => ({
        id: getFreeCoderModelId(model),
        name: model.name,
        provider: model.provider,
        model: model.model,
        roles: model.roles ?? [],
      })),
    });
  }

  public async refreshConfiguredModels(): Promise<void> {
    try {
      await this.sendConfiguredModels();
    } catch (error: any) {
      this._webviewView?.webview.postMessage({
        command: "showError",
        text: error?.message ?? "Failed to reload Main Config.",
      });
    }
  }

  private async getConfiguredModel(
    role:
      | "chat"
      | "edit"
      | "apply"
      | "resolver"
      | "planner"
      | "changeGenerator"
      | "embed",
  ): Promise<FreeCoderModel> {
    const config = await loadFreeCoderConfig();

    const model = config.models.find((item) => item.roles?.includes(role));

    if (!model) {
      throw new Error(
        `No model is configured for the "${role}" role in ~/.freecoder/config.yaml.`,
      );
    }

    return model;
  }

  // Fully converted to real-time NDJSON chunk stream handling with Abort Signal integration
  private async handleChatMessage(data: any, webviewView: vscode.WebviewView) {
    const { text, attachment, attachmentType } = data;
    let chatModel: FreeCoderModel;

    try {
      chatModel = await this.getSelectedModel("chat");
    } catch (error: any) {
      webviewView.webview.postMessage({
        command: "showError",
        text: error?.message ?? "No Chat model is configured.",
      });
      return;
    }

    const provider = chatModel.provider;
    // BLOCK UNSUPPORTED LOCAL IMAGE INPUT
    if (attachment && attachmentType?.startsWith("image/")) {
      if (provider === "ollama") {
        webviewView.webview.postMessage({
          command: "showError",
          text: `Local Ollama Error: ${chatModel.model} is a text model and does not support image uploads.`,
        });
        return;
      }
    }

    // FILE ATTACHMENT CONTEXT
    let attachedFileContext = "";
    const hasFileAttachment = Boolean(
      attachment && !attachmentType?.startsWith("image/"),
    );
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

    const fileReferences = extractWorkspaceFileReferences(text);
    const workspaceContext = await readWorkspaceContextFiles(fileReferences);

    // Do not send the request if any explicitly referenced file is unavailable.
    if (workspaceContext.issues.length > 0) {
      const issueDetails = workspaceContext.issues
        .map((issue) => `• ${issue.path}: ${issue.reason}`)
        .join("\n");

      webviewView.webview.postMessage({
        command: "showError",
        text: `Unable to attach the requested file context. Please correct the following paths and try again:\n\n${issueDetails}`,
      });
      return;
    }

    const referencedFileContext = formatWorkspaceFileContext(
      workspaceContext.files,
    );
    if (workspaceContext.issues.length > 0) {
      const issueDetails = workspaceContext.issues
        .map((issue) => `• ${issue.path}: ${issue.reason}`)
        .join("\n");
      void vscode.window.showWarningMessage(
        `Free Coder could not attach some referenced files:\n${issueDetails}`,
      );
    }

    // FINAL PROMPT
    const finalPromptWithContext =
      text + attachedFileContext + projectContextText + referencedFileContext;

    // START STREAM UI
    webviewView.webview.postMessage({
      command: "startStream",
      provider: "Qwen3-Coder",
    });

    // NORMAL CHAT ABORT CONTROLLER
    this._activeAbortController = new AbortController();

    try {
      if (provider === "ollama") {
        const OLLAMA_URL = `${chatModel.apiBase ?? "http://localhost:11434"}/api/chat`;

        // NORMAL CHAT SYSTEM PROMPT
        const systemMessage = [
          "You are Free Coder, an expert software engineering assistant.",
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
          "When files are included in [USER ATTACHED FILE CONTEXT],",
          "they were explicitly provided by the user.",
          "Use their actual contents when answering.",
          "Treat these files as read-only context.",
          "Do not assume referenced files are modification targets.",
          "When multiple files are included in the user attached file context,",
          "you MUST inspect and consider every attached file.",
          "Explain each attached file separately when the user asks to explain them.",
          "Do not focus only on the first attached file.",
        ].join("\n");

        const payload = {
          model: chatModel.model,
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

  private async handleAgentRequest(
    instruction: string,
    requestedModelId?: string,
  ): Promise<void> {
    /*
     * ---------------------------------------------------------
     * 1. Prevent concurrent Agent tasks.
     * ---------------------------------------------------------
     */
    if (this.isAgentBusy()) {
      vscode.window.showWarningMessage(
        "A FreeCoder Agent task is already in progress. Complete or cancel it before starting another Agent task.",
      );

      this._webviewView?.webview.postMessage({
        command: "agentBusy",
        text: "An Agent task is already running. Complete or cancel it before starting another one.",
      });

      return;
    }

    /*
     * ---------------------------------------------------------
     * 2. Prevent Agent from starting while normal AI chat
     *    is running.
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

    const agentInstruction = instruction.trim();

    if (!agentInstruction) {
      return;
    }

    try {
      /*
       * -------------------------------------------------------
       * 3. Start Agent cancellation controller.
       * -------------------------------------------------------
       */
      this._agentAbortController = new AbortController();

      const signal = this._agentAbortController.signal;

      /*
       * -------------------------------------------------------
       * 3A. Snapshot the selected Agent model.
       *
       * The selected model is captured once when the Agent
       * starts. Later stages must use this same model even
       * if the user changes the model selector while the
       * task is running.
       * -------------------------------------------------------
       */
      const config = await loadFreeCoderConfig();

      const selectedResolverModelId =
        requestedModelId ??
        this._extensionContext.globalState.get<string>(
          FreeCoderViewProvider.SELECTED_MODEL_STATE_KEY,
        );

      const getRoleModel = (
        role: "resolver" | "planner" | "changeGenerator",
        preferredModelId?: string,
      ): FreeCoderModel => {
        const model = getFreeCoderModelForRole(
          config.models,
          role,
          preferredModelId,
        );

        if (model.provider !== "ollama") {
          throw new Error(
            `The "${role}" model "${model.name}" uses unsupported provider "${model.provider}".`,
          );
        }

        return model;
      };

      const resolverModel = getRoleModel("resolver", selectedResolverModelId);

      const plannerModel = getRoleModel("planner");

      const changeGeneratorModel = getRoleModel("changeGenerator");

      const modelSnapshot: AgentModelSnapshot = {
        resolver: getFreeCoderModelId(resolverModel),
        planner: getFreeCoderModelId(plannerModel),
        changeGenerator: getFreeCoderModelId(changeGeneratorModel),
      };

      const agentModelId = modelSnapshot.resolver;

      const modelsToValidate = new Map<string, FreeCoderModel>();

      for (const model of [resolverModel, plannerModel, changeGeneratorModel]) {
        const apiBase = (model.apiBase ?? "http://localhost:11434").replace(
          /\/+$/,
          "",
        );

        const key = [model.provider.toLowerCase(), apiBase, model.model].join(
          "|",
        );

        modelsToValidate.set(key, model);
      }

      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "planning",
        text: "Checking configured Agent models...",
      });

      await Promise.all(
        Array.from(modelsToValidate.values()).map((model) =>
          validateOllamaModelAvailable(model),
        ),
      );

      if (signal.aborted) { return; }

      /*
       * -------------------------------------------------------
       * 4. Show Agent UI.
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
       * 5. Analyze workspace.
       * -------------------------------------------------------
       */
      const analysis = await analyzeProject(rootPath);

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 6. Build LIGHTWEIGHT resolution context.
       *
       * Contains:
       * - active file path
       * - explicit modification target
       * - candidate workspace files
       * - explicitly referenced @file paths
       *
       * Does NOT contain full file contents.
       * -------------------------------------------------------
       */
      const resolutionContext = await buildAgentResolutionContext(
        rootPath,
        analysis,
        agentInstruction,
      );

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 7. Resolve the user's request.
       * -------------------------------------------------------
       */
      const resolution = await resolveAgentRequest(
        agentInstruction,
        resolutionContext,
        modelSnapshot.resolver,
        signal,
      );

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 8. CLARIFICATION.
       *
       * Stop here when the request is ambiguous.
       * Do not read files or generate a plan.
       * -------------------------------------------------------
       */
      if (resolution.status === "clarification") {
        this._pendingAgentClarificationInstruction = agentInstruction;
        this._webviewView?.webview.postMessage({
          command: "agentClarification",
          message: resolution.message ?? "Please clarify your request.",
          options: resolution.options ?? [],
          allowRewrite: resolution.allowRewrite !== false,
        });

        return;
      }

      /*
       * -------------------------------------------------------
       * 8A. LOAD EXPLICITLY REFERENCED CONTEXT FILES.
       *
       * Read files provided using:
       *
       * @src/components/Navbar.tsx
       * @src/components/TodoItem.tsx
       *
       * These files are read-only context.
       * They are NOT automatically modification targets.
       * -------------------------------------------------------
       */
      const referencedFileResult = await readWorkspaceContextFiles(
        resolutionContext.referencedFiles ?? [],
      );

      if (signal.aborted) {
        return;
      }

      /*
       * Do not continue if any explicitly referenced file
       * could not be loaded.
       */
      if (referencedFileResult.issues.length > 0) {
        const issueDetails = referencedFileResult.issues
          .map((issue) => `- ${issue.path}: ${issue.reason}`)
          .join("\n");

        throw new Error(`Unable to load Agent context files:\n${issueDetails}`);
      }

      /*
       * Convert workspace files to Agent FileContext.
       */
      const referencedFiles = referencedFileResult.files.map((file) => ({
        path: file.path,
        content: file.content,
      }));

      /*
       * -------------------------------------------------------
       * 9. Request is clear.
       *
       * ONLY NOW load/generate the Knowledge Graph.
       * -------------------------------------------------------
       */
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "context",
        text: "Reviewing relevant project context...",
      });

      let graph = await loadKnowledgeGraph(rootPath);

      if (signal.aborted) {
        return;
      }

      /*
       * Generate the graph only when one does not already exist.
       */
      graph ??= await generateKnowledgeGraph(analysis);

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 10. Build FULL Agent context.
       *
       * Includes:
       * - active file
       * - related files
       * - referenced file contents
       * - project summary
       * - graph context
       * - project references
       *
       * targetFiles remains separate from referencedFiles.
       * -------------------------------------------------------
       */
      const context = await buildAgentContext(
        rootPath,
        graph,
        analysis,
        resolution.instruction,
        resolution.targetFiles,
        referencedFiles,
      );

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 11. Generate the actual Agent plan.
       * -------------------------------------------------------
       */
      this._webviewView?.webview.postMessage({
        command: "agentProgress",
        stage: "plan",
        text: "Creating the agent plan...",
      });

      const plan = await generateAgentPlan(
        resolution.instruction,
        context,
        modelSnapshot.planner,
        signal,
      );

      if (signal.aborted) {
        return;
      }

      /*
       * -------------------------------------------------------
       * 12. Planner clarification safety boundary.
       * -------------------------------------------------------
       */
      if (plan.status === "clarification") {
        this._webviewView?.webview.postMessage({
          command: "agentClarification",
          message: plan.clarificationMessage ?? "Please clarify your request.",
          options: plan.clarificationOptions ?? [],
          allowRewrite: plan.allowRewrite !== false,
        });

        return;
      }

      /*
       * -------------------------------------------------------
       * 13. Create the AgentTask.
       * -------------------------------------------------------
       */
      const task: AgentTask = {
        id: createTaskId(),

        modelId: agentModelId,
        modelSnapshot,

        instruction: resolution.instruction,

        scope: determineScope(context),

        currentFile: context.currentFile?.path,

        targetFiles: plan.targetFiles,

        context,

        changes: plan.changes.map((change) => ({
          path: change.path,
          operation: change.operation,
          originalPath: change.originalPath,
          newPath: change.newPath,
          explanation: change.reason,
        })),

        status: "review",
      };

      this._currentTask = task;

      /*
       * -------------------------------------------------------
       * 14. Waiting for plan approval.
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
       * -------------------------------------------------------
       * Expected cancellation.
       * -------------------------------------------------------
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
       * The task is required by:
       * - Generate Changes
       * - Diff
       * - Apply
       * - Validation
       * - Undo
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
      "Undo all changes made by the last FreeCoder Agent task?",
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
        `FreeCoder successfully undid ${task.changes.length} change${
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
        `FreeCoder could not undo the Agent changes: ${message}`,
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
      console.error("FreeCoder project analysis refresh failed:", error);
    }
  }

  private isAgentBusy(): boolean {
    /*
     * An Agent request is already running even before an
     * AgentTask has been created.
     *
     * This covers:
     * - request resolution
     * - project analysis
     * - context building
     * - plan generation
     * - change generation
     */
    if (this._agentAbortController) {
      return true;
    }

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

    /*
     * ---------------------------------------------------------
     * 1. Abort the active Agent request immediately.
     * ---------------------------------------------------------
     */
    if (this._agentAbortController) {
      this._agentAbortController.abort();
      this._agentAbortController = null;
    }

    /*
     * ---------------------------------------------------------
     * 2. Mark the task as cancelled.
     * ---------------------------------------------------------
     */
    if (this._currentTask) {
      this._currentTask.status = "cancelled";
    }

    /*
     * ---------------------------------------------------------
     * 3. Tell the WebView immediately.
     *
     * IMPORTANT:
     * Do this BEFORE waiting for diff cleanup.
     * The UI should react immediately to Stop Agent.
     * ---------------------------------------------------------
     */
    this._webviewView?.webview.postMessage({
      command: "agentExecutionCancelled",
    });

    /*
     * ---------------------------------------------------------
     * 4. Clear current Agent task state.
     * ---------------------------------------------------------
     */
    this._currentTask = undefined;

    /*
     * ---------------------------------------------------------
     * 5. Close any temporary Agent diff tabs.
     *
     * This can take some time, but the user has already
     * received the cancellation state above.
     * ---------------------------------------------------------
     */
    try {
      await closeAgentDiffs();
    } catch (error) {
      console.warn(
        "[FreeCoder Agent] Failed to close Agent diff tabs after cancellation:",
        error,
      );
    }

    vscode.window.showInformationMessage("FreeCoder Agent stopped.");
  }
}

export function deactivate() {}
