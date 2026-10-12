import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as ts from "typescript";

import {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "./types";
import { ProjectAnalysis } from "../types";
import { saveKnowledgeGraph } from "./graphStorage";

export async function generateKnowledgeGraph(
  analysis: ProjectAnalysis,
): Promise<KnowledgeGraph | null> {
  const rootPath = analysis.rootPath;

  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Free Copilot: Building Knowledge Graph",
        cancellable: false,
      },

      async (progress) => {
        progress.report({
          message: "Preparing source files...",
        });

        const files = analysis.files
          .filter(
            (file) =>
              file.category === "source" &&
              [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(
                file.extension,
              ),
          )
          .map((file) => path.join(rootPath, file.path));

        progress.report({
          message: `Analyzing ${files.length} source files...`,
        });

        const nodes: KnowledgeGraphNode[] = [];
        const edges: KnowledgeGraphEdge[] = [];
        const edgeSet = new Set<string>();

        const fileSet = new Set(files.map((file) => normalizePath(file)));

        for (const filePath of files) {
          const relativePath = normalizePath(path.relative(rootPath, filePath));

          nodes.push({
            id: relativePath,
            label: path.basename(filePath),
            type: "file",
            path: relativePath,
          });

          const source = await fs.readFile(filePath, "utf8");
          const sourceFile = ts.createSourceFile(
            filePath,
            source,
            ts.ScriptTarget.Latest,
            true,
          );

          const imports = extractImports(sourceFile);
          for (const importPath of imports) {
            const resolvedFile = await resolveImport(
              filePath,
              importPath,
              fileSet,
            );

            if (!resolvedFile) {
              continue;
            }

            const targetRelativePath = normalizePath(
              path.relative(rootPath, resolvedFile),
            );

            const edgeId = `${relativePath}::imports::${targetRelativePath}`;
            if (edgeSet.has(edgeId)) {
              continue;
            }
            edgeSet.add(edgeId);
            edges.push({
              id: edgeId,
              source: relativePath,
              target: targetRelativePath,
              type: "imports",
            });
          }
        }

        const graph: KnowledgeGraph = {
          version: "1.0.0",
          generatedAt: new Date().toISOString(),
          workspaceRoot: rootPath,
          nodes,
          edges,
        };

        await saveKnowledgeGraph(rootPath, graph);
        vscode.window.showInformationMessage(
          `Knowledge Graph generated: ${nodes.length} files, ${edges.length} relationships`,
        );
        return graph;
      },
    );
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Knowledge Graph generation failed: ${error.message}`,
    );

    return null;
  }
}

function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return [...new Set(imports)];
}

async function resolveImport(
  sourceFile: string,
  importPath: string,
  fileSet: Set<string>,
): Promise<string | null> {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const sourceDirectory = path.dirname(sourceFile);

  const basePath = path.resolve(sourceDirectory, importPath);

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePath(candidate);

    if (fileSet.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}
