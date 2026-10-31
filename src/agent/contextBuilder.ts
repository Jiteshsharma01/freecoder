import * as vscode from "vscode";
import * as path from "path";

import { ProjectAnalysis } from "../projectAnalysis/types";

import { KnowledgeGraph } from "../projectAnalysis/knowledgeGraph/types";

import { AgentContext, FileContext, ProjectReference } from "./types";
import { AgentResolutionContext } from "./taskPlanner";
import {
  extractWorkspaceFileReferences,
  removeWorkspaceFileReferences,
} from "../utils/workspaceFileContext";

export interface FileCandidateResult {
  requestedName: string;
  matches: string[];
}

export async function buildAgentContext(
  rootPath: string,
  graph: KnowledgeGraph | null,
  analysis: ProjectAnalysis,
  instruction: string,
  targetFiles: string[],
  referencedFiles: FileContext[] = [],
): Promise<AgentContext> {
  const currentFile = await getActiveFileContext(rootPath, targetFiles);

  const relatedFiles = await getRelatedFileContexts(
    rootPath,
    currentFile,
    graph,
  );

  const graphContext = buildGraphContext(currentFile, graph);

  const projectReferences = await findProjectReferences(
    instruction,
    analysis,
    rootPath,
  );

  const projectSummary = buildProjectSummary(analysis, projectReferences);

  return {
    currentFile: currentFile ?? undefined,
    relatedFiles,
    referencedFiles,
    projectSummary,
    graphContext,
    projectReferences,
  };
}

export function findCandidateFilePaths(
  instruction: string,
  analysis: ProjectAnalysis,
): string[] {
  const candidates = new Set<string>();

  const explicitFile = extractExplicitTargetFile(instruction);

  /*
   * If the user explicitly identified a file,
   * that file is the strongest candidate.
   */
  if (explicitFile) {
    const normalizedExplicit = normalizeProjectPath(explicitFile);

    const exactMatch = analysis.files.find(
      (file) => normalizeProjectPath(file.path) === normalizedExplicit,
    );

    if (exactMatch) {
      candidates.add(normalizeProjectPath(exactMatch.path));

      return [...candidates];
    }
  }

  const fileNames = extractFileNames(instruction);

  /*
   * Only search actual filenames when the instruction
   * contains a filename.
   */
  if (fileNames.size > 0) {
    for (const file of analysis.files) {
      if (fileNames.has(file.name.toLowerCase())) {
        candidates.add(normalizeProjectPath(file.path));
      }
    }

    return [...candidates];
  }

  /*
   * No filename was specified.
   *
   * Do NOT dump project files here.
   * The active file is only a candidate.
   */
  const editor = vscode.window.activeTextEditor;

  if (editor && editor.document.uri.scheme === "file") {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      editor.document.uri,
    );

    const activePath = workspaceFolder
      ? vscode.workspace.asRelativePath(editor.document.uri, false)
      : editor.document.fileName;

    candidates.add(normalizeProjectPath(activePath));
  }

  return [...candidates];
}

function extractFileNames(instruction: string): Set<string> {
  const names = new Set<string>();
  const matches =
    instruction.match(
      /[A-Za-z0-9_$.-]+\.(?:tsx?|jsx?|mjs|cjs|php|css|scss|less|html|json|md)\b/gi,
    ) ?? [];

  for (const match of matches) {
    const baseName = match
      .split(/[\/\\]/)
      .pop()
      ?.trim();

    if (baseName) {
      names.add(baseName.toLowerCase());
    }
  }

  return names;
}

async function getActiveFileContext(
  rootPath: string,
  targetFiles: string[],
): Promise<FileContext | null> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return null;
  }

  if (editor.document.uri.scheme !== "file") {
    return null;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    editor.document.uri,
  );

  const relativePath = workspaceFolder
    ? vscode.workspace.asRelativePath(editor.document.uri, false)
    : path.relative(rootPath, editor.document.fileName).replace(/\\/g, "/");

  const normalizedActive = normalizeProjectPath(relativePath);

  /*
   * If a target file was explicitly resolved and the
   * active file is not one of those targets, don't
   * pretend the active editor is the target.
   */
  if (
    targetFiles.length > 0 &&
    !targetFiles.some(
      (target) => normalizeProjectPath(target) === normalizedActive,
    )
  ) {
    return null;
  }

  return {
    path: normalizedActive,

    language: editor.document.languageId,

    content: buildFileContent(editor.document, editor.selection),
  };
}

function getActiveFilePath(rootPath: string): string | undefined {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== "file") {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    editor.document.uri,
  );

  const relativePath = workspaceFolder
    ? vscode.workspace.asRelativePath(editor.document.uri, false)
    : path.relative(rootPath, editor.document.fileName).replace(/\\/g, "/");

  return normalizeProjectPath(relativePath);
}

function buildFileContent(
  document: vscode.TextDocument,
  selection: vscode.Selection,
): string {
  const content = document.getText();

  if (selection.isEmpty) {
    return content;
  }

  const selectedText = document.getText(selection);

  return [
    "--- FULL FILE ---",
    content,
    "",
    "--- CURRENTLY SELECTED CODE ---",
    selectedText,
    "--- END SELECTED CODE ---",
  ].join("\n");
}

function buildGraphContext(
  currentFile: FileContext | null,
  graph: KnowledgeGraph | null,
) {
  if (!currentFile || !graph) {
    return undefined;
  }

  const dependencies: string[] = [];
  const dependents: string[] = [];

  for (const edge of graph.edges) {
    if (edge.source === currentFile.path) {
      dependencies.push(edge.target);
    }

    if (edge.target === currentFile.path) {
      dependents.push(edge.source);
    }
  }

  return {
    dependencies,
    dependents,
  };
}

async function getRelatedFileContexts(
  rootPath: string,
  currentFile: FileContext | null,
  graph: KnowledgeGraph | null,
): Promise<FileContext[]> {
  if (!currentFile || !graph) {
    return [];
  }

  const relatedPaths = new Map<string, number>();

  for (const edge of graph.edges) {
    if (edge.source === currentFile.path) {
      relatedPaths.set(edge.target, 100);
    }

    if (edge.target === currentFile.path) {
      relatedPaths.set(edge.source, 90);
    }
  }

  const sortedPaths = [...relatedPaths.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([filePath]) => filePath);

  const result: FileContext[] = [];

  for (const relativePath of sortedPaths) {
    if (normalizePath(relativePath) === normalizePath(currentFile.path)) {
      continue;
    }

    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(rootPath, relativePath)),
      );

      result.push({
        path: relativePath,

        content: document.getText(),

        language: document.languageId,
      });
    } catch {
      // Ignore unreadable files.
    }

    if (result.length >= 8) {
      break;
    }
  }

  return result;
}

async function findProjectReferences(
  instruction: string,
  analysis: ProjectAnalysis,
  rootPath: string,
): Promise<ProjectReference[]> {
  const identifiers = extractSearchTerms(instruction);

  if (identifiers.length === 0) {
    return [];
  }

  const references: ProjectReference[] = [];

  const searchableFiles = analysis.files.filter(
    (file) =>
      file.category === "source" ||
      file.category === "test" ||
      file.category === "config",
  );

  for (const file of searchableFiles) {
    const absolutePath = path.join(rootPath, file.path);

    let content: string;

    try {
      content = await vscode.workspace.fs
        .readFile(vscode.Uri.file(absolutePath))
        .then((bytes) => new TextDecoder("utf-8").decode(bytes));
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      const matchesIdentifier = identifiers.some((identifier) =>
        containsIdentifier(line, identifier),
      );

      if (!matchesIdentifier) {
        continue;
      }

      references.push({
        path: normalizeProjectPath(file.path),

        line: lineIndex + 1,

        preview: line.trim(),
      });
    }
  }

  return deduplicateReferences(references);
}

function extractSearchTerms(instruction: string): string[] {
  const terms = new Set<string>();

  const renameMatch = instruction.match(
    /\brename\s+([A-Za-z_$][\w$]*)\s+(?:to|as)\s+([A-Za-z_$][\w$]*)\b/i,
  );

  if (renameMatch?.[1]) {
    terms.add(renameMatch[1]);
  }
  if (renameMatch?.[2]) {
    terms.add(renameMatch[2]);
  }

  const identifierMatches =
    instruction.match(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g) ?? [];

  for (const match of identifierMatches) {
    if (isCommonInstructionWord(match)) {
      continue;
    }
    terms.add(match);
  }

  const fileMatches =
    instruction.match(
      /\b[A-Za-z0-9_$.-]+\.(?:tsx?|jsx?|mjs|cjs|php|css|scss|less|html|json|md)\b/gi,
    ) ?? [];

  for (const file of fileMatches) {
    terms.add(file);
  }

  return [...terms];
}

function extractExplicitTargetFile(instruction: string): string | null {
  const match = instruction.match(
    /\bin\s+(?:this\s+)?file\s*:\s*["']?(.+?)["']?\s*$/im,
  );

  if (!match?.[1]) {
    return null;
  }

  return normalizeProjectPath(match[1].trim());
}

function isCommonInstructionWord(value: string): boolean {
  const words = new Set([
    "add",
    "remove",
    "delete",
    "update",
    "change",
    "modify",
    "create",
    "implement",
    "make",
    "write",
    "use",
    "this",
    "that",
    "file",
    "project",
    "component",
    "function",
    "class",
    "with",
    "from",
    "into",
    "everywhere",
    "all",
    "references",
    "usages",
  ]);
  return words.has(value.toLowerCase());
}

function deduplicateReferences(
  references: ProjectReference[],
): ProjectReference[] {
  const seen = new Set<string>();

  const result: ProjectReference[] = [];

  for (const reference of references) {
    const key = `${reference.path}:${reference.line}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push(reference);
  }

  return result;
}

function buildProjectSummary(
  analysis: ProjectAnalysis,
  references: ProjectReference[],
): string {
  const lines: string[] = [];

  lines.push(`Project type: ${analysis.projectType}`);

  if (analysis.framework) {
    lines.push(`Framework: ${analysis.framework}`);
  }

  if (analysis.frameworkVersion) {
    lines.push(`Framework version: ${analysis.frameworkVersion}`);
  }

  if (analysis.language.length) {
    lines.push(`Languages: ${analysis.language.join(", ")}`);
  }

  if (analysis.technologies.length) {
    lines.push(`Technologies: ${analysis.technologies.join(", ")}`);
  }

  if (references.length) {
    lines.push("", "PROJECT REFERENCES FOUND:");

    for (const reference of references) {
      lines.push(
        `- ${reference.path}:${reference.line} — ${reference.preview}`,
      );
    }
  }

  return lines.join("\n");
}

export async function buildAgentResolutionContext(
  rootPath: string,
  analysis: ProjectAnalysis,
  instruction: string,
): Promise<AgentResolutionContext> {
  // 1. Active file
  const activeFile = getActiveFilePath(rootPath);

  // 2. Extract explicitly attached context files
  const referencedFiles = extractWorkspaceFileReferences(instruction);

  // 3. Exclude @ references from modification-target discovery
  const targetDiscoveryInstruction = removeWorkspaceFileReferences(instruction);

  // 4. Explicit modification target
  const explicitFile = extractExplicitTargetFile(targetDiscoveryInstruction);

  // 5. Candidate modification files
  const candidateFiles = findCandidateFilePaths(
    targetDiscoveryInstruction,
    analysis,
  );

  return {
    activeFile,
    explicitFile: explicitFile ?? undefined,
    candidateFiles,
    referencedFiles,
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function containsIdentifier(line: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);
  return pattern.test(line);
}
