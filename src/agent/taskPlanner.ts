import { AgentContext, FileChange } from "./types";

export interface AgentPlan {
  summary: string;
  reasoning: string;
  targetFiles: string[];
  changes: PlannedChange[];
}

export interface PlannedChange {
  path: string;
  operation: "create" | "modify" | "delete";
  reason: string;
}

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen3-coder:30b";

export async function generateAgentPlan(
  instruction: string,
  context: AgentContext,
  signal?: AbortSignal
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

  if (normalizedPlan.targetFiles.length === 0) {
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
    "operation must be one of:",
    "create, modify, delete",
    "",
    "Only include files that are actually relevant",
    "to the requested task.",
    "",
    "Prefer the smallest safe set of files.",
  ].join("\n");
}

function buildPlannerPrompt(
  instruction: string,
  context: AgentContext,
): string {
  const sections: string[] = [];

  sections.push("USER REQUEST:", instruction);

  sections.push("", "TASK SCOPE:");

  if (context.projectReferences && context.projectReferences.length > 0) {
    sections.push(
      "The request appears to involve project-wide references.",
      "Review PROJECT-WIDE REFERENCES carefully before choosing target files.",
    );
  } else if (context.currentFile) {
    sections.push("The request is currently associated with the active file.");
  } else {
    sections.push(
      "No active file is available. Determine the scope from the request and available project context.",
    );
  }

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

  if (context.projectReferences && context.projectReferences.length > 0) {
    sections.push("", "============= PROJECT-WIDE REFERENCES =========");

    for (const reference of context.projectReferences) {
      sections.push(
        `FILE: ${reference.path}`,
        `LINE: ${reference.line}`,
        `MATCH: ${reference.preview}`,
        "",
      );
    }

    sections.push("=========== END PROJECT-WIDE REFERENCES =======");
  }

  if (context.projectSummary) {
    sections.push(
      "",
      "================ PROJECT SUMMARY =============",
      context.projectSummary,
      "============== END PROJECT SUMMARY ============",
    );
  }

  if (context.graphContext) {
    sections.push("", "================ GRAPH CONTEXT ================");

    sections.push("DIRECT DEPENDENCIES:");

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
  }

  sections.push(
    "",
    "================ PLANNING RULES ===============",
    "1. Use the smallest safe set of files necessary.",
    "2. For 'everywhere', 'all references', 'all usages', 'rename', or 'replace' requests, inspect project-wide references.",
    "3. targetFiles must include every file that needs modification.",
    "4. Do not include files that do not need modification.",
    "5. Preserve tests when they refer to the changed symbol.",
    "6. Include related imports/usages when they must change because of the requested operation.",
    "7. Do not modify generated files, build output, dependency folders, or unrelated files.",
    "8. Do not make changes yet. Only produce the plan.",
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

  for (const file of plan.targetFiles) {
    if (typeof file === "string" && file.trim()) {
      targetFiles.add(normalizePath(file));
    }
  }

  for (const change of plan.changes) {
    if (typeof change.path === "string" && change.path.trim()) {
      targetFiles.add(normalizePath(change.path));
    }
  }

  if (context.projectReferences && context.projectReferences.length > 0) {
    for (const reference of context.projectReferences) {
      targetFiles.add(normalizePath(reference.path));
    }
  }

  if (targetFiles.size === 0 && context.currentFile?.path) {
    targetFiles.add(normalizePath(context.currentFile.path));
  }

  return {
    ...plan,
    targetFiles: [...targetFiles],
    changes: plan.changes.map((change) => ({
      ...change,
      path: normalizePath(change.path),
    })),
  };
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
