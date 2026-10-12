import * as vscode from "vscode";
import * as path from "path";

import { ProjectAnalysis } from "../projectAnalysis/types";
import { KnowledgeGraph } from "../projectAnalysis/knowledgeGraph/types";

export interface ActiveFileContext {
  path: string;
  language: string;
  content: string;
  selectedText: string;
  selection: {
    startLine: number;
    endLine: number;
    startCharacter: number;
    endCharacter: number;
  } | null;
}

export interface RelatedFileContext {
  path: string;
  reason: string;
  content: string;
}

export interface ProjectContext {
  rootPath: string;
  analysis: ProjectAnalysis;
  activeFile: ActiveFileContext | null;
  relatedFiles: RelatedFileContext[];
  graph: KnowledgeGraph | null;
}

interface BuildProjectContextOptions {
  rootPath: string;
  instruction: string;
  analysis: ProjectAnalysis;
  graph?: KnowledgeGraph | null;
}

export async function buildProjectContext(
  options: BuildProjectContextOptions,
): Promise<ProjectContext> {
  const { rootPath, analysis, graph = null } = options;

  const activeFile = await getActiveFileContext();

  const relatedFiles = await getRelatedFiles(
    rootPath,
    activeFile,
    graph,
    analysis,
  );

  return {
    rootPath,
    analysis,
    activeFile,
    relatedFiles,
    graph,
  };
}

async function getActiveFileContext(): Promise<ActiveFileContext | null> {
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
    : document.fileName;

  const selection = editor.selection;

  const hasSelection = !selection.isEmpty;

  return {
    path: relativePath,
    language: document.languageId,
    content: document.getText(),
    selectedText: hasSelection ? document.getText(selection) : "",
    selection: hasSelection
      ? {
          startLine: selection.start.line + 1,
          endLine: selection.end.line + 1,
          startCharacter: selection.start.character + 1,
          endCharacter: selection.end.character + 1,
        }
      : null,
  };
}

async function getRelatedFiles(
  rootPath: string,
  activeFile: ActiveFileContext | null,
  graph: KnowledgeGraph | null,
  analysis: ProjectAnalysis,
): Promise<RelatedFileContext[]> {
  if (!activeFile || !graph) {
    return [];
  }

  const relatedPaths = new Map<string, string>();

  const activeNode = graph.nodes.find(
    (node) => node.path === activeFile.path || node.id === activeFile.path,
  );

  if (!activeNode) {
    return [];
  }

  for (const edge of graph.edges) {
    if (edge.source === activeNode.id) {
      relatedPaths.set(edge.target, "Imported by active file");
    }

    if (edge.target === activeNode.id) {
      relatedPaths.set(edge.source, "Imports active file");
    }
  }

  const result: RelatedFileContext[] = [];

  for (const [relativePath, reason] of relatedPaths) {
    if (relativePath === activeFile.path) {
      continue;
    }

    const absolutePath = path.join(rootPath, relativePath);

    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absolutePath),
      );

      result.push({
        path: relativePath,
        reason,
        content: document.getText(),
      });
    } catch {
      // Ignore files that cannot be opened.
    }
  }

  return limitRelatedFiles(result, analysis);
}

function limitRelatedFiles(
  files: RelatedFileContext[],
  analysis: ProjectAnalysis,
): RelatedFileContext[] {
  const MAX_RELATED_FILES = 8;

  if (files.length <= MAX_RELATED_FILES) {
    return files;
  }

  const sourcePaths = new Set(
    analysis.files
      .filter((file) => file.category === "source")
      .map((file) => file.path),
  );

  return files
    .sort((a, b) => {
      const aIsSource = sourcePaths.has(a.path);
      const bIsSource = sourcePaths.has(b.path);

      if (aIsSource === bIsSource) {
        return 0;
      }

      return aIsSource ? -1 : 1;
    })
    .slice(0, MAX_RELATED_FILES);
}

export function formatProjectContextForAI(context: ProjectContext): string {
  const sections: string[] = [];

  sections.push(`PROJECT ROOT:\n${context.rootPath}`);

  if (context.analysis.projectType) {
    sections.push(`PROJECT TYPE:\n${context.analysis.projectType}`);
  }

  if (context.activeFile) {
    sections.push(
      [
        "ACTIVE FILE:",
        `Path: ${context.activeFile.path}`,
        `Language: ${context.activeFile.language}`,
        "",
        "CONTENT:",
        "```",
        context.activeFile.content,
        "```",
      ].join("\n"),
    );

    if (context.activeFile.selectedText) {
      sections.push(
        [
          "CURRENTLY SELECTED CODE:",
          "```",
          context.activeFile.selectedText,
          "```",
        ].join("\n"),
      );
    }
  }

  if (context.relatedFiles.length > 0) {
    const relatedSection = ["RELATED FILES:"];

    for (const file of context.relatedFiles) {
      relatedSection.push(
        "",
        `FILE: ${file.path}`,
        `REASON: ${file.reason}`,
        "```",
        file.content,
        "```",
      );
    }

    sections.push(relatedSection.join("\n"));
  }

  return [
    "",
    "================ PROJECT CONTEXT ================",
    "",
    sections.join("\n\n"),
    "",
    "===================================================",
    "",
  ].join("\n");
}
