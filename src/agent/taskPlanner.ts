import { isFileDeletionRequest } from "./requestClassifier";
import { extractJsonObject } from "./changeGenerator";
import { AgentContext, FileChange } from "./types";
import { ProjectAnalysis } from "../projectAnalysis/types";
import { findCandidateFilePaths } from "./contextBuilder";
import {
  getFreeCoderModelId,
  loadFreeCoderConfig,
  FreeCoderModel,
} from "../config/modelConfig";

export type AgentPlanStatus = "ready" | "clarification";
export type AgentResolutionStatus = "ready" | "clarification";

export interface AgentResolution {
  status: AgentResolutionStatus;
  instruction: string;
  targetFiles: string[];
  message?: string;
  options?: AgentClarificationOption[];
  allowRewrite?: boolean;
}

export interface AgentResolutionContext {
  activeFile?: string;
  explicitFile?: string;
  candidateFiles: string[];
  referencedFiles: string[];
}

export interface AgentClarificationOption {
  id: string;
  label: string;
  instruction: string;
}

export interface AgentPlan {
  status: AgentPlanStatus;
  summary: string;
  reasoning: string;
  targetFiles: string[];
  changes: PlannedChange[];
  clarificationMessage?: string;
  clarificationOptions?: AgentClarificationOption[];
  allowRewrite?: boolean;
}

export interface PlannedChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  originalPath?: string;
  newPath?: string;
  reason: string;
}

async function getConfiguredAgentModel(
  role:
    | "chat"
    | "edit"
    | "apply"
    | "resolver"
    | "planner"
    | "changeGenerator"
    | "embed",
  modelId?: string,
): Promise<FreeCoderModel> {
  const config = await loadFreeCoderConfig();

  const model = modelId
    ? config.models.find(
        (item) =>
          getFreeCoderModelId(item) === modelId && item.roles?.includes(role),
      )
    : config.models.find((item) => item.roles?.includes(role));

  if (!model) {
    if (modelId) {
      throw new Error(
        `The selected Agent model "${modelId}" is not configured or does not support the "${role}" role.`,
      );
    }

    throw new Error(
      `No model is configured for the "${role}" role in ~/.freecoder/config.yaml.`,
    );
  }

  if (model.provider !== "ollama") {
    throw new Error(
      `The "${role}" role currently supports only the "ollama" provider. Configured provider: ${model.provider}`,
    );
  }

  return model;
}

export async function generateAgentPlan(
  instruction: string,
  context: AgentContext,
  modelId: string,
  signal?: AbortSignal,
): Promise<AgentPlan> {
  const plannerModel = await getConfiguredAgentModel("planner", modelId);

  const apiBase = plannerModel.apiBase ?? "http://localhost:11434";

  const ollamaUrl = `${apiBase.replace(/\/$/, "")}/api/chat`;

  const prompt = buildPlannerPrompt(instruction, context);

  if (signal?.aborted) {
    throw new DOMException(
      "Agent planning was cancelled before it started.",
      "AbortError",
    );
  }

  const response = await fetch(ollamaUrl, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      model: plannerModel.model,

      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: prompt,
        },
      ],

      format: "json",
      stream: false,
    }),

    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama planner returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    message?: {
      content?: string;
    };
  };

  const rawContent = data.message?.content?.trim();

  if (!rawContent) {
    throw new Error("Ollama returned an empty agent plan.");
  }

  const parsedPlan = parseAgentPlan(rawContent);

  /*
   * CLARIFICATION
   * Do not normalize/validate target files because there
   * intentionally may not be any yet.
   */
  if (parsedPlan.status === "clarification") {
    return parsedPlan;
  }

  /*
   * =========================================================
   * NORMAL READY PLAN
   * =========================================================
   */
  const normalizedPlan = normalizeAgentPlan(parsedPlan, context, instruction);
  const validatedPlan = validateAgentPlan(normalizedPlan);
  if (validatedPlan.targetFiles.length === 0) {
    throw new Error(
      [
        "The agent could not determine any target files.",
        "Try selecting the relevant file or making the requested scope explicit.",
      ].join(" "),
    );
  }

  return validatedPlan;
}

function buildSystemPrompt(): string {
  return [
    "You are the planning engine for FreeCoder,",
    "a VS Code AI coding assistant.",
    "",
    "Your job is to understand the user's request,",
    "inspect the provided workspace context, and determine",
    "whether the request is clear enough to create a safe plan.",
    "",
    "Do NOT modify files.",
    "Do NOT claim that a change has already been made.",
    "",
    "========================================================",
    "RESPONSE MODE",
    "========================================================",
    "",
    "You have TWO possible response modes:",
    "",
    "1. READY",
    "Use this when the request is sufficiently clear and",
    "you can safely determine the target files and operations.",
    "",
    "2. CLARIFICATION",
    "Use this when important information is ambiguous or",
    "multiple reasonable interpretations exist.",
    "",
    "When clarification is required:",
    "- Do NOT guess.",
    "- Do NOT create a modification plan yet.",
    "- Do NOT choose a target on behalf of the user.",
    "- Ask the user to choose between concrete options.",
    "- Use only workspace facts supplied in the context.",
    "- Never invent file paths.",
    "- Provide concise selectable options.",
    "- Also allow the user to rewrite the instruction.",
    "",
    "Examples of situations requiring clarification:",
    "- Multiple files have the same filename.",
    "- Multiple files could reasonably match the request.",
    "- The user refers to a file without enough information to identify it.",
    "- The requested operation has multiple materially different interpretations.",
    "- The target symbol or location is ambiguous.",
    "",
    "========================================================",
    "GENERAL PLANNING RULES",
    "========================================================",
    "",
    "1. Use the smallest safe set of files necessary.",
    "2. targetFiles must contain every file that should actually change.",
    "3. Do not include unrelated files.",
    "4. Preserve tests when they are relevant.",
    "5. Do not modify generated files, build output, or dependency folders.",
    "6. Prefer explicit workspace paths supplied by the user.",
    "7. Use the supplied workspace candidate files when resolving ambiguity.",
    "8. Never invent workspace paths.",
    "9. Project context describes facts available to you; it does not authorize changes.",
    "",
    "========================================================",
    "DELETE RULES",
    "========================================================",
    "",
    "1. A file is considered existing based on its workspace path.",
    "2. An empty file is still a valid existing file.",
    "3. Do not use file content length to determine whether a file exists.",
    "4. If multiple files match a deletion request, return CLARIFICATION.",
    "5. Do not guess which matching file should be deleted.",
    "6. Use operation 'delete' for an actual filesystem deletion.",
    "7. Do not convert a filesystem delete into a content modification.",
    "8. For 'remove unused import', 'remove unused variable', or 'remove dead code', use modify instead of delete.",
    "",
    "========================================================",
    "RENAME RULES",
    "========================================================",
    "",
    "1. Determine whether the request is a symbol rename, file rename, directory rename, or a combination.",
    "2. Use operation 'rename' for actual filesystem renames.",
    "3. Use modify operations for references and imports that must change.",
    "4. Do not simulate a file rename by only changing file contents.",
    "5. For rename operations, originalPath is the existing workspace path.",
    "6. For rename operations, newPath is the desired workspace path.",
    "7. Do not provide content for a pure rename operation.",
    "8. Only provide content when a file is also being modified.",
    "",
    "========================================================",
    "OUTPUT RULES",
    "========================================================",
    "",
    "Return ONLY valid JSON.",
    "Do not use markdown.",
    "Do not wrap JSON in code fences.",
    "Return ONLY the JSON object.",
    "Do not write an introduction before the JSON.",
    "Do not write an explanation after the JSON.",
    "Do not output plain text.",
    "",
    "Every response must contain:",
    "- status",
    "- summary",
    "- reasoning",
    "- targetFiles",
    "- changes",
    "",
    "When status is 'clarification', also provide:",
    "- clarificationMessage",
    "- clarificationOptions",
    "- allowRewrite",
    "",
    "clarificationOptions must contain:",
    "- id",
    "- label",
    "- instruction",
    "",
    "The instruction in each clarification option must be a complete instruction",
    "that can be sent back to the Agent after the user selects that option.",
    "",
    "========================================================",
    "READY RESPONSE STRUCTURE",
    "========================================================",
    "",
    "{",
    '  "status": "ready",',
    '  "summary": "short summary",',
    '  "reasoning": "why these files are relevant",',
    '  "targetFiles": ["path/to/file.ts"],',
    '  "changes": [',
    "    {",
    '      "path": "path/to/file.ts",',
    '      "operation": "modify",',
    '      "reason": "why this file changes"',
    "    }",
    "  ]",
    "}",
    "",
    "========================================================",
    "CLARIFICATION RESPONSE STRUCTURE",
    "========================================================",
    "",
    "{",
    '  "status": "clarification",',
    '  "summary": "Clarification required",',
    '  "reasoning": "Why the request cannot safely be resolved yet",',
    '  "targetFiles": [],',
    '  "changes": [],',
    '  "clarificationMessage": "Which file do you want to remove?",',
    '  "clarificationOptions": [',
    "    {",
    '      "id": "1",',
    '      "label": "src/app/components/testFile.tsx",',
    '      "instruction": "Remove src/app/components/testFile.tsx from the project."',
    "    }",
    "  ],",
    '  "allowRewrite": true',
    "}",
    "",
    "========================================================",
    "ALLOWED OPERATIONS",
    "========================================================",
    "",
    "create",
    "modify",
    "delete",
    "rename",
    "",
    "Only include files that are actually relevant to the requested task.",
  ].join("\n");
}

function buildPlannerPrompt(
  instruction: string,
  context: AgentContext,
): string {
  const sections: string[] = [];
  const isDeleteRequest = isFileDeletionRequest(instruction);
  const isRenameRequest = /\brename\b/i.test(instruction);
  const isEverywhereRequest =
    /\b(?:everywhere|all references|all usages|all occurrences)\b/i.test(
      instruction,
    );
  const isReplaceRequest = /\breplace\b/i.test(instruction);

  const explicitTargetFile = extractExplicitTargetFile(instruction);

  // 1. USER REQUEST
  sections.push(
    "================ USER REQUEST ================",
    instruction,
    "============== END USER REQUEST ==============",
  );

  if (context.candidateFiles && context.candidateFiles.length > 0) {
    sections.push(
      "",
      "================ WORKSPACE CANDIDATES ================",
      "",
      "The following paths were discovered from the actual workspace.",
      "These are factual candidate paths, not an indication of which target the user intended.",
      "Use them when determining whether clarification is required.",
      "Never invent another path.",
      "",
      ...context.candidateFiles.map((file) => `- ${file}`),
      "",
      "============== END WORKSPACE CANDIDATES ==============",
    );
  }

  if (explicitTargetFile) {
    sections.push(
      "",
      "================ EXPLICIT TARGET FILE ================",
      `USER-SUPPLIED TARGET: ${explicitTargetFile}`,
      "",
      "The user explicitly identified this workspace file.",
      "Use this exact normalized path in targetFiles.",
      "Do not replace it with another similarly named file.",
      "Only add related files when the requested change actually requires them.",
      "=======================================================",
    );
  }

  // 2. REQUEST ANALYSIS
  sections.push("", "================ REQUEST ANALYSIS =============");

  if (isRenameRequest) {
    sections.push(
      "REQUEST TYPE: RENAME",
      "",
      "This is a rename request.",
      "",
      "Determine which kinds of changes are required:",
      "1. Symbol rename",
      "2. File rename",
      "3. Directory rename",
      "4. Reference/import updates",
      "5. A combination of the above",
    );
  } else if (isDeleteRequest) {
    sections.push(
      "REQUEST TYPE: DELETE",
      "",
      "This is a file/directory deletion request.",
    );
  } else if (isReplaceRequest) {
    sections.push("REQUEST TYPE: REPLACE");
  } else {
    sections.push("REQUEST TYPE: GENERAL MODIFICATION");
  }

  // REQUEST SCOPE
  if (isEverywhereRequest) {
    sections.push(
      "",
      "SCOPE: PROJECT-WIDE",
      "The user explicitly requested a project-wide operation.",
      "All relevant references must be considered before selecting target files.",
    );
  } else if (context.currentFile) {
    sections.push(
      "",
      "SCOPE: ACTIVE FILE / RELATED FILES",
      `The request is currently associated with: ${context.currentFile.path}`,
    );
  } else {
    sections.push(
      "",
      "SCOPE: PROJECT",
      "No active file is available. Determine the safest scope from the request and available project context.",
    );
  }

  sections.push("============== END REQUEST ANALYSIS ===========");

  // 3. CURRENT FILE
  if (context.currentFile) {
    sections.push(
      "",
      "================ CURRENT FILE ================",
      `PATH: ${context.currentFile.path}`,
      `LANGUAGE: ${context.currentFile.language ?? "unknown"}`,
      "",
      context.currentFile.content,
      "============== END CURRENT FILE ==============",
    );
  }

  // 4. RELATED FILES
  if (context.relatedFiles && context.relatedFiles.length > 0) {
    sections.push("", "================ RELATED FILES ================");

    for (const file of context.relatedFiles) {
      sections.push(
        "",
        `FILE: ${file.path}`,
        `LANGUAGE: ${file.language ?? "unknown"}`,
        "",
        file.content,
        "-----------------------------------------------",
      );
    }

    sections.push("============== END RELATED FILES ==============");
  }

  // 5. PROJECT-WIDE REFERENCES
  if (context.projectReferences && context.projectReferences.length > 0) {
    sections.push(
      "",
      "============= PROJECT-WIDE REFERENCES =========",
      `Found ${context.projectReferences.length} project reference(s).`,
      "",
      "These are candidate files/locations that may be affected by the request.",
      "Do not automatically modify every reference.",
      "Determine which references are actually relevant to the requested operation.",
      "",
    );

    for (const reference of context.projectReferences) {
      sections.push(
        `FILE: ${reference.path}`,
        `LINE: ${reference.line}`,
        `MATCH: ${reference.preview}`,
        "",
      );
    }

    sections.push("=========== END PROJECT-WIDE REFERENCES =======");
  } else {
    sections.push(
      "",
      "============= PROJECT-WIDE REFERENCES =========",
      "No project-wide references were found by the reference scanner.",
      "Do not assume that there are no references; use the available file and graph context.",
      "=========== END PROJECT-WIDE REFERENCES =======",
    );
  }

  // 6. PROJECT SUMMARY
  if (context.projectSummary) {
    sections.push(
      "",
      "================ PROJECT SUMMARY =============",
      context.projectSummary,
      "============== END PROJECT SUMMARY ============",
    );
  }

  // 7. KNOWLEDGE GRAPH CONTEXT
  if (context.graphContext) {
    sections.push(
      "",
      "================ GRAPH CONTEXT ================",
      "",
      "DIRECT DEPENDENCIES:",
    );

    if (context.graphContext.dependencies.length > 0) {
      sections.push(
        ...context.graphContext.dependencies.map((file) => `- ${file}`),
      );
    } else {
      sections.push("- None identified");
    }

    sections.push("", "DIRECT DEPENDENTS:");

    if (context.graphContext.dependents.length > 0) {
      sections.push(
        ...context.graphContext.dependents.map((file) => `- ${file}`),
      );
    } else {
      sections.push("- None identified");
    }

    sections.push("============== END GRAPH CONTEXT ==============");
  } else {
    sections.push(
      "",
      "================ GRAPH CONTEXT ================",
      "No knowledge graph context is available.",
      "============== END GRAPH CONTEXT ==============",
    );
  }

  // 8. DELETE-SPECIFIC TASK CONTEXT
  if (isDeleteRequest) {
    sections.push(
      "",
      "================ DELETE TASK =================",
      "",
      "This request asks to delete a file or directory.",
      "",
      "Deletion rules:",
      "1. Identify the exact existing workspace path before creating the plan.",
      "2. Do not guess between multiple files with the same filename.",
      "3. If a filename matches multiple workspace paths, the intended file must be resolved explicitly.",
      "4. An empty file is still a valid existing file.",
      "5. File existence must be determined from the workspace path, not from file content.",
      "6. Use operation 'delete' for an actual filesystem deletion.",
      "7. Do not convert a delete request into a modify operation.",
      "8. Do not generate replacement content for a delete operation.",
      "9. Use the exact path selected or identified from the workspace.",
      "10. If the extension host provides a RESOLVED DELETE TARGET, that path is authoritative.",
      "11. Never select a different file when a resolved delete target is supplied.",
      "12. Words such as 'remove' do not automatically mean filesystem deletion.",
      "13. Requests such as 'remove unused import', 'remove unused variable', or 'remove dead code' are content modifications.",
      "14. If multiple workspace candidates could reasonably satisfy the request, return status 'clarification' instead of guessing.",
      "15. Use clarificationOptions to present the actual candidate paths to the user.",
      "16. Each clarification option must contain an instruction that can be submitted again after selection.",
      "17. The extension-provided workspace candidates are authoritative facts.",
      "",
      "=============== END DELETE TASK ===============",
    );
  }

  // 9. RENAME-SPECIFIC TASK CONTEXT
  if (isRenameRequest) {
    sections.push(
      "",
      "================ RENAME TASK =================",
      "",
      "Before creating the plan, determine whether this request requires:",
      "",
      "- changing a symbol name only",
      "- renaming an actual file",
      "- renaming an actual directory",
      "- updating imports/references",
      "- updating tests",
      "- or a combination of these",
      "",
      "Use the project references, current file, related files,",
      "and graph context to determine the required operations.",
      "",
      "IMPORTANT:",
      "A symbol rename and a filesystem rename are different operations.",
      "Do not assume that changing every textual occurrence means the file itself should be renamed.",
      "",
      "For example:",
      "",
      "User request:",
      "Rename TodoList to TodoCollection everywhere.",
      "",
      "Potential consequences:",
      "- TodoList symbol may become TodoCollection.",
      "- TodoList.tsx may need to become TodoCollection.tsx.",
      "- A TodoList directory may need to become TodoCollection.",
      "- Imports may need to be updated.",
      "- JSX usages may need to be updated.",
      "- Tests may need to be updated.",
      "",
      "Only include operations that are actually required by the project.",
      "",
      "=============== END RENAME TASK ===============",
    );
  }

  // 10. PLANNING INSTRUCTIONS
  sections.push(
    "",
    "================ TASK INSTRUCTIONS ============",
    "1. Analyze the user's exact request before deciding target files.",
    "2. Use the active file when the request is file-specific.",
    "3. Use related files when dependencies/references require them.",
    "4. Use project-wide references for project-wide requests.",
    "5. Use graph relationships to understand dependencies and dependents.",
    "6. Prefer the smallest safe set of affected files.",
    "7. targetFiles must include every file that will actually be modified, created, deleted, or renamed.",
    "8. Do not add unrelated files merely because they mention a similar name.",
    "9. Preserve tests when they are affected by the requested change.",
    "10. Do not include generated output, build output, dependency folders, or unrelated files.",
    "11. Plan only. Do not generate replacement file contents.",
    "12. Do not claim that changes have already been applied.",
    "13. Distinguish content modifications from filesystem operations.",
    "14. For delete requests, verify the exact target path and never guess when multiple files have the same filename.",
    "15. An empty file is still a valid delete target.",
    "16. For rename requests, identify filesystem rename operations separately from content/reference modifications.",
    "================================================",
  );

  return sections.join("\n");
}

function parseAgentPlan(rawText: string): AgentPlan {
  const jsonText = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("The AI returned an invalid agent plan JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The AI returned an invalid agent plan.");
  }

  const value = parsed as Record<string, unknown>;
  const rawStatus = value.status;
  const status: AgentPlanStatus =
    rawStatus === "clarification" ? "clarification" : "ready";
  let summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const reasoning =
    typeof value.reasoning === "string" ? value.reasoning.trim() : "";

  const targetFiles = Array.isArray(value.targetFiles)
    ? value.targetFiles.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];

  const changes = Array.isArray(value.changes)
    ? value.changes
        .filter((item) => isPlannedChange(item))
        .map((item) => item as PlannedChange)
    : [];

  /*
   * ---------------------------------------------------------
   * READY PLAN
   * ---------------------------------------------------------
   */
  if (status === "ready") {
    /*
     * Recover targetFiles if Qwen forgot them but supplied
     * valid changes.
     */
    if (targetFiles.length === 0 && changes.length > 0) {
      targetFiles.push(...changes.map((change) => change.path));
    }

    if (!summary) {
      if (changes.length === 1) {
        summary = `Plan to ${changes[0].operation} ${changes[0].path}`;
      } else if (changes.length > 1) {
        summary = `Plan to apply ${changes.length} file operations.`;
      } else {
        summary = "Plan generated for the requested task.";
      }
    }

    return {
      status: "ready",
      summary,
      reasoning,
      targetFiles,
      changes,
    };
  }

  const clarificationMessage =
    typeof value.clarificationMessage === "string"
      ? value.clarificationMessage.trim()
      : "";

  const rawOptions = Array.isArray(value.clarificationOptions)
    ? value.clarificationOptions
    : [];

  const clarificationOptions = rawOptions
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): AgentClarificationOption | null => {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const instruction =
        typeof item.instruction === "string" ? item.instruction.trim() : "";

      if (!id || !label || !instruction) {
        return null;
      }
      return {
        id,
        label,
        instruction,
      };
    })
    .filter((item): item is AgentClarificationOption => item !== null);

  if (!summary) {
    summary = "Clarification required.";
  }

  if (!clarificationMessage) {
    throw new Error(
      "The AI requested clarification but did not provide a clarification message.",
    );
  }

  if (clarificationOptions.length === 0) {
    throw new Error(
      "The AI requested clarification but did not provide any selectable options.",
    );
  }

  return {
    status: "clarification",
    summary,
    reasoning,
    targetFiles: [],
    changes: [],
    clarificationMessage,
    clarificationOptions,
    allowRewrite: value.allowRewrite !== false,
  };
}

function normalizeAgentPlan(
  plan: AgentPlan,
  context: AgentContext,
  instruction?: string,
): AgentPlan {
  const targetFiles = new Set<string>();

  const explicitTargetFile = instruction
    ? extractExplicitTargetFile(instruction)
    : null;
  if (explicitTargetFile) {
    targetFiles.add(explicitTargetFile);
  }

  /*
   * ---------------------------------------------------------
   * 1. Trust the planner's explicitly selected targetFiles.
   * ---------------------------------------------------------
   */
  for (const file of plan.targetFiles) {
    if (typeof file === "string" && file.trim()) {
      targetFiles.add(normalizePath(file));
    }
  }

  /*
   * ---------------------------------------------------------
   * 2. Every explicit change in the plan must also be a
   *    target file.
   *
   *    This protects us if the model puts a file in changes[]
   *    but forgets to add it to targetFiles[].
   * ---------------------------------------------------------
   */
  for (const change of plan.changes) {
    if (typeof change.path === "string" && change.path.trim()) {
      targetFiles.add(normalizePath(change.path));
    }

    /*
     * Rename operations affect BOTH paths.
     *
     * The old path must be considered an affected file even
     * though path represents the destination/new path.
     */
    if (change.operation === "rename") {
      if (
        typeof change.originalPath === "string" &&
        change.originalPath.trim()
      ) {
        targetFiles.add(normalizePath(change.originalPath));
      }

      if (typeof change.newPath === "string" && change.newPath.trim()) {
        targetFiles.add(normalizePath(change.newPath));
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * 3. For file-specific requests, fall back to the active
   *    file ONLY if the planner produced no target files.
   *
   *    Do NOT automatically add projectReferences here.
   * ---------------------------------------------------------
   */
  if (targetFiles.size === 0 && context.currentFile?.path) {
    targetFiles.add(normalizePath(context.currentFile.path));
  }

  /*
   * ---------------------------------------------------------
   * 4. Normalize the change paths.
   * ---------------------------------------------------------
   */
  const normalizedChanges = plan.changes.map((change) => ({
    ...change,
    path: normalizePath(change.path),
    originalPath: change.originalPath
      ? normalizePath(change.originalPath)
      : undefined,
    newPath: change.newPath ? normalizePath(change.newPath) : undefined,
  }));

  return {
    ...plan,
    targetFiles: [...targetFiles],
    changes: normalizedChanges,
  };
}

function validateAgentPlan(plan: AgentPlan): AgentPlan {
  for (const change of plan.changes) {
    if (change.operation === "rename") {
      if (!change.originalPath || !change.newPath) {
        throw new Error(
          `Invalid rename operation for "${change.path}". Both originalPath and newPath are required.`,
        );
      }

      if (
        normalizePath(change.originalPath) === normalizePath(change.newPath)
      ) {
        throw new Error(
          `Invalid rename operation: source and destination are identical for "${change.path}".`,
        );
      }
    }
  }

  return plan;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function extractExplicitCreateTargetFile(instruction: string): string | null {
  if (!/\b(?:create|add|make|write|generate)\b/i.test(instruction)) {
    return null;
  }

  const matches = [
    ...instruction.matchAll(
      /(?:^|[\s"'`])((?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9_-]+)(?=$|[\s"'`,;])/g,
    ),
  ];

  const paths = [...new Set(matches.map((match) => normalizePath(match[1])))];

  // Do not guess if the request mentions multiple file paths.
  return paths.length === 1 ? paths[0] : null;
}

function extractExplicitTargetFile(instruction: string): string | null {
  const match = instruction.match(
    /\bin\s+(?:this\s+)?file\s*:\s*["']?([^"'\\\r\n]+(?:\\[^"'\\\r\n]+)*)["']?/i,
  );
  if (!match?.[1]) {
    return null;
  }
  return normalizePath(match[1].trim());
}

function isPlannedChange(value: unknown): value is PlannedChange {
  if (!value || typeof value !== "object") {
    return false;
  }

  const change = value as Record<string, unknown>;

  if (typeof change.path !== "string") {
    return false;
  }
  if (typeof change.reason !== "string") {
    return false;
  }
  if (
    change.operation !== "create" &&
    change.operation !== "modify" &&
    change.operation !== "delete" &&
    change.operation !== "rename"
  ) {
    return false;
  }

  if (change.operation === "rename") {
    if (
      typeof change.originalPath !== "string" ||
      typeof change.newPath !== "string"
    ) {
      return false;
    }
  }

  return true;
}

function buildResolutionSystemPrompt(): string {
  return [
    "You are the request-resolution engine for FreeCoder.",
    "",
    "Your only job is to understand what the user wants the Agent to work on.",
    "Do not generate code.",
    "Do not generate file contents.",
    "Do not create a modification plan.",
    "",
    "Use the workspace facts provided by the extension.",
    "Never invent existing files or paths.",
    "",
    "IMPORTANT DISTINCTION BETWEEN CONTEXT AND TARGET FILES:",
    "",
    "1. EXPLICITLY ATTACHED CONTEXT FILES:",
    "- These are files supplied by the user using @file/path syntax.",
    "- They are provided so the Agent can understand and reference their contents.",
    "- They are read-only context by default.",
    "- Do NOT automatically include them in targetFiles.",
    "- Include one in targetFiles only when the user explicitly requests changes to that file.",
    "",
    "2. MODIFICATION TARGET FILES:",
    "- targetFiles must contain files the Agent should create, modify, delete, or rename.",
    "- Use explicit modification targets and relevant workspace candidates.",
    "- Do not include files merely because they appear in the attached context list.",
    "- Prefer the smallest safe set of modification targets.",
    "",
    "EXAMPLE:",
    "User request:",
    "Update Navbar.tsx to support a mobile menu.",
    "Use TodoItem.tsx as a reference.",
    "",
    "Attached context:",
    "- src/components/TodoItem.tsx",
    "",
    "Correct targetFiles:",
    '["src/components/Navbar.tsx"]',
    "",
    "Do NOT include TodoItem.tsx unless the user explicitly asks to modify it.",
    "",
    "Return status 'ready' when the request is sufficiently clear.",
    "Return status 'clarification' when the request is ambiguous.",
    "",
    "Examples requiring clarification:",
    "- Multiple files match the requested modification target.",
    "- The user refers to a file but several workspace files could match it.",
    "- The request could reasonably refer to different modification targets.",
    "",
    "For clarification:",
    "- Do not guess.",
    "- Present actual workspace candidates.",
    "- Give the user concise selectable options.",
    "- Each option must contain a complete instruction for continuing the request.",
    "- Set allowRewrite to true.",
    "",
    "For ready:",
    "- For create/add/write/generate requests, an explicitly named new file is a valid target even if it does not exist yet.",
    "- If the user specifies a filename and asks for the root directory, use that filename as a workspace-relative root path.",
    "- Always include an explicitly requested new file in targetFiles.",
    "- If a file creation request does not specify a filename, request clarification.",
    "- Do not use an attached context file as a new-file target just because its path is explicitly mentioned.",
    "",
    "Return ONLY valid JSON.",
    "Do not use markdown.",
    "Do not wrap the JSON in code fences.",
    "",
    "READY FORMAT:",
    "{",
    '  "status": "ready",',
    '  "instruction": "original or clarified instruction",',
    '  "targetFiles": ["path/to/file.ts"]',
    "}",
    "",
    "CLARIFICATION FORMAT:",
    "{",
    '  "status": "clarification",',
    '  "instruction": "original instruction",',
    '  "targetFiles": [],',
    '  "message": "Which file do you mean?",',
    '  "options": [',
    "    {",
    '      "id": "1",',
    '      "label": "src/a/testFile.tsx",',
    '      "instruction": "Remove src/a/testFile.tsx from the project."',
    "    }",
    "  ],",
    '  "allowRewrite": true',
    "}",
  ].join("\n");
}

function buildResolutionPrompt(
  instruction: string,
  context: AgentResolutionContext,
): string {
  const sections: string[] = [];

  // USER REQUEST
  sections.push(
    "================ USER REQUEST ================",
    instruction,
    "============== END USER REQUEST ==============",
  );

  // WORKSPACE FACTS
  sections.push("", "================ WORKSPACE FACTS =============");

  sections.push(`ACTIVE FILE: ${context.activeFile ?? "none"}`);

  if (context.explicitFile) {
    sections.push(`EXPLICIT MODIFICATION TARGET: ${context.explicitFile}`);
  }

  if (context.referencedFiles?.length) {
    sections.push(
      "",
      "EXPLICITLY ATTACHED CONTEXT FILES (READ-ONLY REFERENCES):",
      ...context.referencedFiles.map((file) => `- ${file}`),
      "",
      "These files were explicitly provided for context.",
      "They are NOT automatically modification targets.",
    );
  } else {
    sections.push("", "EXPLICITLY ATTACHED CONTEXT FILES: none");
  }

  if (context.candidateFiles.length > 0) {
    sections.push(
      "",
      "CANDIDATE MODIFICATION FILES:",
      ...context.candidateFiles.map((file) => `- ${file}`),
    );
  } else {
    sections.push("", "CANDIDATE MODIFICATION FILES: none identified");
  }

  sections.push("============== END WORKSPACE FACTS ===========");

  return sections.join("\n");
}

function validateAgentResolution(
  value: unknown,
  instruction: string,
): AgentResolution {
  if (!value || typeof value !== "object") {
    throw new Error("The AI returned an invalid Agent resolution.");
  }

  const data = value as Record<string, unknown>;
  const rawStatus = data.status;

  if (rawStatus !== "ready" && rawStatus !== "clarification") {
    throw new Error(
      `The AI returned an invalid Agent resolution status. Response: ${JSON.stringify(data)}`,
    );
  }

  const status = rawStatus as AgentResolutionStatus;

  const resolvedInstruction =
    typeof data.instruction === "string" && data.instruction.trim()
      ? data.instruction.trim()
      : instruction;

  const targetFiles: string[] = Array.isArray(data.targetFiles)
    ? data.targetFiles
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim() !== "",
        )
        .map((item) => normalizePath(item))
    : [];

  const message = typeof data.message === "string" ? data.message.trim() : "";

  const options: AgentClarificationOption[] = Array.isArray(data.options)
    ? data.options
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        .map((item): AgentClarificationOption | null => {
          if (
            typeof item.id !== "string" ||
            typeof item.label !== "string" ||
            typeof item.instruction !== "string"
          ) {
            return null;
          }

          const id = item.id.trim();
          const label = item.label.trim();
          const optionInstruction = item.instruction.trim();

          if (!id || !label || !optionInstruction) {
            return null;
          }

          return {
            id,
            label,
            instruction: optionInstruction,
          };
        })
        .filter((item): item is AgentClarificationOption => item !== null)
    : [];

  const explicitCreateTarget = extractExplicitCreateTargetFile(instruction);

  // Handle requests that are ready to proceed.
  if (status === "ready") {
    if (targetFiles.length === 0 && explicitCreateTarget) {
      targetFiles.push(explicitCreateTarget);
    }

    if (targetFiles.length === 0) {
      throw new Error(
        `The AI marked the request ready but did not provide target files. Response: ${JSON.stringify(data)}`,
      );
    }

    return {
      status: "ready",
      instruction: resolvedInstruction,
      targetFiles,
    };
  }

  // Recover from an incomplete clarification only when the request
  // explicitly identifies a file that can be created.
  if (!message || options.length === 0) {
    if (explicitCreateTarget) {
      return {
        status: "ready",
        instruction: resolvedInstruction,
        targetFiles: [explicitCreateTarget],
      };
    }

    throw new Error(
      `The AI returned an incomplete clarification. Response: ${JSON.stringify(data)}`,
    );
  }

  // Return a valid clarification request.
  return {
    status: "clarification",
    instruction: resolvedInstruction,
    targetFiles: [],
    message,
    options,
    allowRewrite: data.allowRewrite !== false,
  };
}

export async function resolveAgentRequest(
  instruction: string,
  context: AgentResolutionContext,
  modelId: string,
  signal?: AbortSignal,
): Promise<AgentResolution> {
  const resolverModel = await getConfiguredAgentModel("resolver", modelId);

  const apiBase = resolverModel.apiBase ?? "http://localhost:11434";

  const ollamaUrl = `${apiBase.replace(/\/$/, "")}/api/chat`;

  const prompt = buildResolutionPrompt(instruction, context);

  if (signal?.aborted) {
    throw new DOMException(
      "Agent request resolution was cancelled.",
      "AbortError",
    );
  }

  const response = await fetch(ollamaUrl, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      model: resolverModel.model,

      messages: [
        {
          role: "system",
          content: buildResolutionSystemPrompt(),
        },
        {
          role: "user",
          content: prompt,
        },
      ],

      format: "json",
      stream: false,
    }),

    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama request resolver returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    message?: {
      content?: string;
    };
  };

  const rawContent = data.message?.content?.trim();

  if (!rawContent) {
    throw new Error("Ollama returned an empty request-resolution response.");
  }

  const jsonText = extractJsonObject(rawContent);

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      "The AI returned invalid JSON while resolving the Agent request.",
    );
  }

  return validateAgentResolution(parsed, instruction);
}
