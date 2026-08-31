import { AgentContext, FileChange } from "./types";

export interface AgentPlan {
  summary: string;
  reasoning: string;
  targetFiles: string[];
  changes: PlannedChange[];
}

export interface PlannedChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  originalPath?: string;
  newPath?: string;
  reason: string;
}

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen3-coder:30b";

export async function generateAgentPlan(
  instruction: string,
  context: AgentContext,
  signal?: AbortSignal,
): Promise<AgentPlan> {
  const prompt = buildPlannerPrompt(instruction, context);

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
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

  const normalizedPlan = normalizeAgentPlan(parsedPlan, context);
  const validatedPlan = validateAgentPlan(normalizedPlan);

  if (validatedPlan.targetFiles.length === 0) {
    throw new Error(
      [
        "The agent could not determine any target files.",
        "Try selecting the relevant file or making the requested scope explicit.",
      ].join(" "),
    );
  }

  return normalizedPlan;
}

function buildSystemPrompt(): string {
  return [
    "You are the planning engine for FreeCopilot,",
    "a VS Code AI coding assistant.",
    "",
    "Your job is to analyze the user request and",
    "the provided code context, then create a SAFE",
    "file modification plan.",
    "",
    "Do NOT modify files.",
    "Do NOT claim that a change has already been made.",
    "",
    "Return ONLY valid JSON.",
    "Do not use markdown.",
    "Do not wrap the JSON in ``` fences.",
    "",
    "GENERAL PLANNING RULES:",
    "1. Use the smallest safe set of files necessary.",
    "2. targetFiles must contain every file that should be changed.",
    "3. Do not include unrelated files.",
    "4. Preserve tests when they are relevant.",
    "5. Do not modify generated files, build output, or dependency folders.",
    "",
    "RENAME RULES:",
    "1. Determine whether the request is a symbol rename, file rename, directory rename, or a combination.",
    "2. Use operation 'rename' for actual filesystem renames.",
    "3. Use modify operations for references and imports that must change.",
    "4. Do not simulate a file rename by only changing file contents.",
    "5. For rename operations, originalPath is the existing workspace path.",
    "6. For rename operations, newPath is the desired workspace path.",
    "7. Do not provide content for a pure rename operation.",
    "8. Only provide content when a file is also being modified.",
    "",
    "RENAME EXAMPLE:",
    "If the user says 'Rename TodoList to TodoCollection everywhere',",
    "the plan may require:",
    "- rename the TodoList file",
    "- rename a TodoList test file",
    "- modify imports",
    "- modify JSX/component references",
    "- modify other project references",
    "",
    "The JSON must have exactly this structure:",
    "",
    "{",
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
    "Allowed operations:",
    "create, modify, delete, rename",
    "",
    "For rename operations, use:",
    "{",
    '  "path": "new/path/file.ts",',
    '  "operation": "rename",',
    '  "originalPath": "old/path/file.ts",',
    '  "newPath": "new/path/file.ts",',
    '  "reason": "why the file is renamed"',
    "}",
    "",
    "Only include files that are actually relevant",
    "to the requested task.",
  ].join("\n");
}

function buildPlannerPrompt(
  instruction: string,
  context: AgentContext,
): string {
  const sections: string[] = [];

  /*
   * ---------------------------------------------------------
   * 1. USER REQUEST
   * ---------------------------------------------------------
   */
  sections.push(
    "================ USER REQUEST ================",
    instruction,
    "============== END USER REQUEST ==============",
  );

  /*
   * ---------------------------------------------------------
   * 2. DETERMINE REQUEST SCOPE
   * ---------------------------------------------------------
   */
  sections.push("", "================ REQUEST ANALYSIS =============");

  const isRenameRequest = /\brename\b/i.test(instruction);

  const isEverywhereRequest =
    /\b(everywhere|all references|all usages|all occurrences)\b/i.test(
      instruction,
    );

  const isReplaceRequest = /\breplace\b/i.test(instruction);

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
  } else if (isReplaceRequest) {
    sections.push("REQUEST TYPE: REPLACE");
  } else {
    sections.push("REQUEST TYPE: GENERAL MODIFICATION");
  }

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
      "No active file is available. Determine the safest scope from the project context.",
    );
  }

  sections.push("============== END REQUEST ANALYSIS ===========");

  /*
   * ---------------------------------------------------------
   * 3. CURRENT FILE
   * ---------------------------------------------------------
   */
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

  /*
   * ---------------------------------------------------------
   * 4. RELATED FILES
   * ---------------------------------------------------------
   */
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

  /*
   * ---------------------------------------------------------
   * 5. PROJECT-WIDE REFERENCES
   * ---------------------------------------------------------
   */
  if (context.projectReferences && context.projectReferences.length > 0) {
    sections.push(
      "",
      "============= PROJECT-WIDE REFERENCES =========",
      `Found ${context.projectReferences.length} project reference(s).`,
      "",
      "These are candidate files/locations affected by the request.",
      "Do not automatically modify every reference; determine which ones are actually relevant.",
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

  /*
   * ---------------------------------------------------------
   * 6. PROJECT SUMMARY
   * ---------------------------------------------------------
   */
  if (context.projectSummary) {
    sections.push(
      "",
      "================ PROJECT SUMMARY =============",
      context.projectSummary,
      "============== END PROJECT SUMMARY ============",
    );
  }

  /*
   * ---------------------------------------------------------
   * 7. KNOWLEDGE GRAPH CONTEXT
   * ---------------------------------------------------------
   */
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

  /*
   * ---------------------------------------------------------
   * 8. RENAME-SPECIFIC TASK CONTEXT
   * ---------------------------------------------------------
   *
   * This is contextual information for THIS request.
   * Permanent rename rules remain in buildSystemPrompt().
   * ---------------------------------------------------------
   */
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

  /*
   * ---------------------------------------------------------
   * 9. PLANNING INSTRUCTIONS FOR THIS REQUEST
   * ---------------------------------------------------------
   */
  sections.push(
    "",
    "================ TASK INSTRUCTIONS ============",
    "1. Analyze the user's exact request before deciding target files.",
    "2. Use the active file when the request is file-specific.",
    "3. Use related files when dependencies/references require them.",
    "4. Use project-wide references for project-wide requests.",
    "5. Use graph relationships to understand dependencies and dependents.",
    "6. Prefer the smallest safe set of affected files.",
    "7. targetFiles must include every file that will actually be modified or renamed.",
    "8. Do not add unrelated files merely because they mention a similar name.",
    "9. Preserve tests when they are affected by the requested change.",
    "10. Do not include generated output, build output, dependency folders, or unrelated files.",
    "11. Plan only. Do not generate replacement file contents.",
    "12. Do not claim that changes have already been applied.",
    "13. Distinguish content modifications from filesystem operations.",
    "14. For rename requests, identify the required rename and modification operations separately.",
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

  const summary = typeof value.summary === "string" ? value.summary.trim() : "";

  const reasoning =
    typeof value.reasoning === "string" ? value.reasoning.trim() : "";

  const targetFiles = Array.isArray(value.targetFiles)
    ? value.targetFiles.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const changes = Array.isArray(value.changes)
    ? value.changes
        .filter((item) => isPlannedChange(item))
        .map((item) => item as PlannedChange)
    : [];

  if (!summary) {
    throw new Error("Agent plan is missing a summary.");
  }

  if (targetFiles.length === 0 && changes.length > 0) {
    targetFiles.push(...changes.map((change) => change.path));
  }

  return {
    summary,
    reasoning,
    targetFiles,
    changes,
  };
}

function normalizeAgentPlan(plan: AgentPlan, context: AgentContext): AgentPlan {
  const targetFiles = new Set<string>();

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

function isPlannedChange(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const change = value as Record<string, unknown>;

  return (
    typeof change.path === "string" &&
    (change.operation === "create" ||
      change.operation === "modify" ||
      change.operation === "delete") &&
    typeof change.reason === "string"
  );
}

function extractJsonObject(rawText: string): string {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");

  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find a JSON object in the AI response.");
  }

  return cleaned.slice(start, end + 1);
}
