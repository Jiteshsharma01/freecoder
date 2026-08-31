import * as fs from "fs/promises";
import * as path from "path";

import { AgentTask, FileChange } from "./types";

interface AIFileChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  originalPath?: string;
  newPath?: string;
  content?: string;
  reason?: string;
}

interface AIChangeResponse {
  changes: AIFileChange[];
}

const OLLAMA_URL = "http://localhost:11434/api/chat";

const OLLAMA_MODEL = "qwen3-coder:30b";

export async function generateFileChanges(
  task: AgentTask,
  rootPath: string,
  signal?: AbortSignal,
): Promise<FileChange[]> {
  if (task.targetFiles.length === 0) {
    throw new Error("The agent plan does not contain any target files.");
  }

  const currentFiles = await readTargetFiles(task, rootPath);

  const prompt = buildChangeGenerationPrompt(task, currentFiles);

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
    throw new Error(`Ollama change generator returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    message?: {
      content?: string;
    };
  };

  const rawContent = data.message?.content?.trim();

  if (!rawContent) {
    throw new Error("Ollama returned an empty change response.");
  }

  const parsed = parseChangeResponse(rawContent);

  return validateGeneratedChanges(parsed.changes, task, currentFiles);
}

interface CurrentFile {
  path: string;

  exists: boolean;

  content?: string;
}

async function readTargetFiles(
  task: AgentTask,
  rootPath: string,
): Promise<CurrentFile[]> {
  const results: CurrentFile[] = [];

  /*
   * Use a Set so rename operations do not cause
   * the same file to be read multiple times.
   */
  const pathsToRead = new Set<string>();

  /*
   * Normal target files from the approved plan.
   */
  for (const relativePath of task.targetFiles) {
    pathsToRead.add(normalizePath(relativePath));
  }

  /*
   * Rename operations need both paths available
   * to the change generator/validator:
   *
   * originalPath = existing source file
   * newPath      = destination
   */
  for (const change of task.changes) {
    if (change.operation !== "rename") {
      continue;
    }

    if (change.originalPath) {
      pathsToRead.add(normalizePath(change.originalPath));
    }

    if (change.newPath) {
      pathsToRead.add(normalizePath(change.newPath));
    }
  }

  for (const relativePath of pathsToRead) {
    const absolutePath = resolveSafePath(rootPath, relativePath);

    try {
      const content = await fs.readFile(absolutePath, "utf8");

      results.push({
        path: relativePath,
        exists: true,
        content,
      });
    } catch (error: any) {
      /*
       * ENOENT means the path does not currently exist.
       *
       * This is expected for:
       * - create targets
       * - rename destinations
       */
      if (error?.code === "ENOENT") {
        results.push({
          path: relativePath,
          exists: false,
        });

        continue;
      }

      throw error;
    }
  }

  return results;
}

function buildSystemPrompt(): string {
  return [
    "You are the file-editing engine for FreeCopilot.",
    "",
    "The user has already reviewed and approved an agent plan.",
    "",
    "Your job is to generate the exact file contents required",
    "to perform that approved plan.",
    "",
    "IMPORTANT RULES:",
    "",
    "1. Do not explain the changes outside the JSON.",
    "2. Return ONLY valid JSON.",
    "3. Never wrap the JSON in markdown fences.",
    "4. For modify/create operations, return the COMPLETE file content.",
    "5. Do not return patches.",
    '6. Do not use placeholders such as "...rest of file...".',
    "7. Preserve existing code that should not change.",
    "8. Do not modify files that are not in the approved target list.",
    "9. Use exactly the paths supplied by the plan.",
    "10. For delete operations, omit content.",
    "",
    "Required JSON structure:",
    "",
    "{",
    '  "changes": [',
    "    {",
    '      "path": "src/example.ts",',
    '      "operation": "modify",',
    '      "content": "complete file content",',
    '      "reason": "what changed"',
    "    }",
    "  ]",
    "}",
    "",
    "Allowed operations:",
    "create",
    "modify",
    "delete",
  ].join("\n");
}

function buildChangeGenerationPrompt(
  task: AgentTask,
  currentFiles: CurrentFile[],
): string {
  const sections: string[] = [];

  sections.push("APPROVED USER REQUEST:", task.instruction);

  sections.push("", "APPROVED PLAN:");

  for (const change of task.changes) {
    sections.push(
      "",
      `FILE: ${change.path}`,
      `OPERATION: ${change.operation}`,
      `REASON: ${change.explanation ?? "No additional reason provided."}`,
    );
  }

  sections.push("", "CURRENT FILE CONTENTS:");

  for (const file of currentFiles) {
    sections.push(
      "",
      "================================================",
      `FILE: ${file.path}`,
      `EXISTS: ${file.exists}`,
      "================================================",
    );

    if (file.exists && file.content !== undefined) {
      sections.push(file.content);
    } else {
      sections.push("[FILE DOES NOT CURRENTLY EXIST]");
    }
  }

  sections.push("", "Return the complete proposed file contents as JSON.");

  return sections.join("\n");
}

function parseChangeResponse(rawText: string): AIChangeResponse {
  const jsonText = extractJsonObject(rawText);

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("The AI returned invalid JSON for file changes.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The AI returned an invalid change response.");
  }

  const value = parsed as Record<string, unknown>;

  if (!Array.isArray(value.changes)) {
    throw new Error("The AI change response is missing the changes array.");
  }

  const changes = value.changes.filter(isAIFileChange);

  return {
    changes,
  };
}

function isAIFileChange(value: unknown): value is AIFileChange {
  if (!value || typeof value !== "object") {
    return false;
  }

  const change = value as Record<string, unknown>;

  if (typeof change.path !== "string") {
    return false;
  }

  if (
    change.operation !== "create" &&
    change.operation !== "modify" &&
    change.operation !== "delete"
  ) {
    return false;
  }

  if (change.operation !== "delete" && typeof change.content !== "string") {
    return false;
  }

  if (change.reason !== undefined && typeof change.reason !== "string") {
    return false;
  }

  return true;
}

function validateGeneratedChanges(
  generated: AIFileChange[],
  task: AgentTask,
  currentFiles: CurrentFile[],
): FileChange[] {
  const allowedPaths = new Set(task.targetFiles.map(normalizePath));

  const currentFileMap = new Map(
    currentFiles.map((file) => [normalizePath(file.path), file]),
  );

  const results: FileChange[] = [];

  for (const generatedChange of generated) {
    const normalizedPath = normalizePath(generatedChange.path);

    /*
     * =========================================================
     * RENAME
     * =========================================================
     *
     * For rename:
     *
     * originalPath = existing source
     * newPath      = destination
     * path         = destination/new path
     *
     * We intentionally handle rename BEFORE the normal
     * current-file lookup because the destination does not
     * normally exist yet.
     * =========================================================
     */
    if (generatedChange.operation === "rename") {
      if (!generatedChange.originalPath || !generatedChange.newPath) {
        throw new Error(
          `Rename operation for "${generatedChange.path}" requires both originalPath and newPath.`,
        );
      }

      const normalizedOriginal = normalizePath(generatedChange.originalPath);

      const normalizedNew = normalizePath(generatedChange.newPath);

      /*
       * Source and destination must be different.
       */
      if (normalizedOriginal === normalizedNew) {
        throw new Error(
          `Rename source and destination cannot be identical: ${generatedChange.originalPath}`,
        );
      }

      /*
       * Both paths are affected by a rename.
       *
       * The original path must be approved because the
       * Agent is changing that existing file's identity.
       *
       * The new path must also be approved because the Agent
       * is creating that destination path.
       */
      if (!allowedPaths.has(normalizedOriginal)) {
        throw new Error(
          `AI attempted to rename an unapproved source file: ${generatedChange.originalPath}`,
        );
      }

      if (!allowedPaths.has(normalizedNew)) {
        throw new Error(
          `AI attempted to rename to an unapproved destination: ${generatedChange.newPath}`,
        );
      }

      /*
       * Existing source MUST exist.
       */
      const originalFile = currentFileMap.get(normalizedOriginal);

      if (!originalFile || !originalFile.exists) {
        throw new Error(
          `File to rename does not exist: ${generatedChange.originalPath}`,
        );
      }

      /*
       * Destination MUST NOT exist.
       */
      const destinationFile = currentFileMap.get(normalizedNew);

      if (destinationFile?.exists) {
        throw new Error(
          `Rename destination already exists: ${generatedChange.newPath}`,
        );
      }

      /*
       * Pure rename must not contain generated content.
       *
       * This is an extra safety check so the model cannot
       * accidentally treat rename as a content replacement.
       */
      if (generatedChange.content !== undefined) {
        throw new Error(
          `Rename operation must not contain file content: ${generatedChange.path}`,
        );
      }

      results.push({
        path: normalizedNew,

        operation: "rename",

        originalPath: normalizedOriginal,

        newPath: normalizedNew,

        originalContent: originalFile.content,

        explanation: generatedChange.reason,
      });

      continue;
    }

    /*
     * =========================================================
     * CREATE
     * =========================================================
     */
    if (generatedChange.operation === "create") {
      if (!allowedPaths.has(normalizedPath)) {
        throw new Error(
          `AI attempted to create an unapproved file: ${generatedChange.path}`,
        );
      }

      const current = currentFileMap.get(normalizedPath);

      /*
       * If the file exists, creating it would overwrite an
       * existing workspace file.
       */
      if (current?.exists) {
        throw new Error(
          `AI requested creation of a file that already exists: ${generatedChange.path}`,
        );
      }

      /*
       * A create operation MUST have complete content.
       */
      if (typeof generatedChange.content !== "string") {
        throw new Error(
          `AI did not return complete content for new file ${generatedChange.path}`,
        );
      }

      results.push({
        path: normalizedPath,

        operation: "create",

        originalContent: undefined,

        newContent: generatedChange.content,

        explanation: generatedChange.reason,
      });

      continue;
    }

    /*
     * =========================================================
     * MODIFY / DELETE
     * =========================================================
     */
    if (!allowedPaths.has(normalizedPath)) {
      throw new Error(
        `AI attempted to modify an unapproved file: ${generatedChange.path}`,
      );
    }

    /*
     * Both modify and delete require an existing file.
     */
    const current = currentFileMap.get(normalizedPath);

    if (!current || !current.exists) {
      throw new Error(
        `Unable to validate generated file: ${generatedChange.path}`,
      );
    }

    /*
     * =========================================================
     * DELETE
     * =========================================================
     */
    if (generatedChange.operation === "delete") {
      /*
       * Delete must not contain new content.
       */
      if (generatedChange.content !== undefined) {
        throw new Error(
          `Delete operation must not contain file content: ${generatedChange.path}`,
        );
      }

      results.push({
        path: normalizedPath,

        operation: "delete",

        /*
         * Keep the snapshot so the apply stage can verify
         * the file hasn't changed since the Agent inspected it.
         */
        originalContent: current.content,

        explanation: generatedChange.reason,
      });

      continue;
    }

    /*
     * =========================================================
     * MODIFY
     * =========================================================
     */
    if (generatedChange.operation === "modify") {
      /*
       * Modify MUST contain complete resulting content.
       */
      if (typeof generatedChange.content !== "string") {
        throw new Error(
          `AI did not return complete content for ${generatedChange.path}`,
        );
      }

      results.push({
        path: normalizedPath,

        operation: "modify",

        originalContent: current.content,

        newContent: generatedChange.content,

        explanation: generatedChange.reason,
      });

      continue;
    }

    /*
     * =========================================================
     * UNKNOWN OPERATION
     * =========================================================
     */
    throw new Error(
      `Unsupported AI file operation: ${generatedChange.operation}`,
    );
  }

  /*
   * The AI must produce at least one usable operation.
   */
  if (results.length === 0) {
    throw new Error("The AI did not generate any valid file changes.");
  }
  return results;
}

function resolveSafePath(rootPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  const absolutePath = path.resolve(rootPath, relativePath);

  const relativeFromRoot = path.relative(rootPath, absolutePath);

  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Path escapes the workspace: ${relativePath}`);
  }

  return absolutePath;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
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
