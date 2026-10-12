import { KnowledgeGraph } from "../projectAnalysis/knowledgeGraph/types";
import { ProjectAnalysis } from "../projectAnalysis/types";
import { buildAgentContext } from "./contextBuilder";
import { AgentPlan, generateAgentPlan } from "./taskPlanner";
import { AgentTask } from "./types";

export type AgentTaskResult = AgentTask | AgentPlan;

export async function runAgentTask(
  instruction: string,
  rootPath: string,
  graph: KnowledgeGraph | null,
  analysis: ProjectAnalysis,
  targetFiles: string[],
  modelId: string,
  signal?: AbortSignal,
): Promise<AgentTask | AgentPlan> {
  /*
   * ---------------------------------------------------------
   * 1. Build the FULL Agent context.
   *
   * This happens only AFTER request resolution has already
   * determined which files are relevant.
   * ---------------------------------------------------------
   */
  const context = await buildAgentContext(
    rootPath,
    graph,
    analysis,
    instruction,
    targetFiles,
  );

  if (signal?.aborted) {
    throw new DOMException(
      "Agent task was cancelled before planning.",
      "AbortError",
    );
  }

  /*
   * ---------------------------------------------------------
   * 2. Generate the actual Agent plan.
   * ---------------------------------------------------------
   */
  const plan = await generateAgentPlan(instruction, context, modelId, signal);

  /*
   * ---------------------------------------------------------
   * 3. The richer context may reveal ambiguity that was not
   * visible during the lightweight resolution stage.
   *
   * Return the clarification directly.
   * ---------------------------------------------------------
   */
  if (plan.status === "clarification") {
    return plan;
  }

  /*
   * ---------------------------------------------------------
   * 4. Create the actual AgentTask.
   * ---------------------------------------------------------
   */
  return {
    id: createTaskId(),

    modelId,

    instruction,

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
}

export function isAgentTask(result: AgentTaskResult): result is AgentTask {
  return (
    "id" in result &&
    "instruction" in result &&
    "scope" in result &&
    "context" in result &&
    "status" in result
  );
}

export function determineScope(
  context: AgentTask["context"],
): AgentTask["scope"] {
  if (context.projectReferences && context.projectReferences.length > 0) {
    return "project";
  }

  if (context.currentFile && context.relatedFiles.length > 0) {
    return "related";
  }

  if (context.currentFile) {
    return "file";
  }

  return "project";
}

export function createTaskId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return [Date.now().toString(36), Math.random().toString(36).slice(2)].join(
    "-",
  );
}
