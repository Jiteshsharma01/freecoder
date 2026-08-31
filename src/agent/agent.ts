import { KnowledgeGraph } from "../projectAnalysis/knowledgeGraph/types";

import { ProjectAnalysis } from "../projectAnalysis/types";

import { buildAgentContext } from "./contextBuilder";

import { generateAgentPlan } from "./taskPlanner";

import { AgentTask } from "./types";

export async function runAgentTask(
  instruction: string,
  rootPath: string,
  graph: KnowledgeGraph | null,
  analysis: ProjectAnalysis,
  signal?: AbortSignal
): Promise<AgentTask> {
  const context = await buildAgentContext(
    rootPath,
    graph,
    analysis,
    instruction,
  );

  const plan = await generateAgentPlan(instruction, context, signal);

  return {
    id: createTaskId(),

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

function determineScope(context: AgentTask["context"]): AgentTask["scope"] {
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

function createTaskId(): string {
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
