import * as vscode from "vscode";
import * as path from "path";

import { ProjectAnalysis } from "../projectAnalysis/types";

import { KnowledgeGraph } from "../projectAnalysis/knowledgeGraph/types";

import { AgentContext, FileContext, ProjectReference } from "./types";

export async function buildAgentContext(
  rootPath: string,
  graph: KnowledgeGraph | null,
  analysis: ProjectAnalysis,
  instruction: string,
): Promise<AgentContext> {
  const currentFile = await getActiveFileContext(rootPath);

  const relatedFiles = await getRelatedFileContexts(
    rootPath,
    currentFile,
    graph,
  );

  const graphContext = buildGraphContext(currentFile, graph);

  const projectReferences = await findProjectReferences(instruction, analysis, rootPath);

  const projectSummary = buildProjectSummary(analysis, projectReferences);

  return {
    currentFile: currentFile ?? undefined,

    relatedFiles,

    projectSummary,

    graphContext,

    projectReferences,
  };
}

async function getActiveFileContext(
  rootPath: string,
): Promise<FileContext | null> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return null;
  }

  const document = editor.document;

  if (document.uri.scheme !== "file") {
    return null;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

  const relativePath = workspaceFolder
    ? vscode.workspace.asRelativePath(document.uri, false)
    : path.relative(rootPath, document.fileName).replace(/\\/g, "/");

  return {
    path: relativePath,

    language: document.languageId,

    content: buildFileContent(document, editor.selection),
  };
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

function containsIdentifier(line: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const pattern = new RegExp(`\\b${escaped}\\b`);

  return pattern.test(line);
}

function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function extractSearchTerms(instruction: string): string[] {
  const terms = new Set<string>();

  const renameMatch = instruction.match(
    /\brename\s+([A-Za-z_$][\w$]*)\s+(?:to|as)\s+([A-Za-z_$][\w$]*)\b/i,
  );

  if (renameMatch?.[1]) {
    terms.add(renameMatch[1]);
  }

  const identifierMatches =
    instruction.match(/\b[A-Z][A-Za-z0-9_$]{2,}\b/g) ?? [];

  for (const match of identifierMatches) {
    terms.add(match);
  }

  return [...terms];
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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
