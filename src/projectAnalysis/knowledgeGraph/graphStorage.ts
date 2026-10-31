import * as fs from "fs/promises";
import * as path from "path";

import {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "./types";

export async function loadKnowledgeGraph(
  rootPath: string,
): Promise<KnowledgeGraph | null> {
  const graphPath = path.join(rootPath, ".freecoder", "knowledge-graph.json");

  try {
    const raw = await fs.readFile(graphPath, "utf8");

    const parsed: unknown = JSON.parse(raw);

    if (!isKnowledgeGraph(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    // Graph has not been generated yet,
    // or the file cannot be read.
    return null;
  }
}

export async function saveKnowledgeGraph(
  rootPath: string,
  graph: KnowledgeGraph,
): Promise<string> {
  const outputDirectory = path.join(rootPath, ".freecoder");
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "knowledge-graph.json");
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2), "utf8");
  return outputPath;
}

function isKnowledgeGraph(value: unknown): value is KnowledgeGraph {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<KnowledgeGraph>;

  if (
    typeof candidate.version !== "string" ||
    typeof candidate.generatedAt !== "string" ||
    typeof candidate.workspaceRoot !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return false;
  }

  return (
    candidate.nodes.every(isKnowledgeGraphNode) &&
    candidate.edges.every(isKnowledgeGraphEdge)
  );
}

function isKnowledgeGraphNode(value: unknown): value is KnowledgeGraphNode {
  if (!value || typeof value !== "object") {
    return false;
  }

  const node = value as Partial<KnowledgeGraphNode>;

  return (
    typeof node.id === "string" &&
    typeof node.label === "string" &&
    node.type === "file" &&
    typeof node.path === "string"
  );
}

function isKnowledgeGraphEdge(value: unknown): value is KnowledgeGraphEdge {
  if (!value || typeof value !== "object") {
    return false;
  }

  const edge = value as Partial<KnowledgeGraphEdge>;

  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    (edge.type === "imports" ||
      edge.type === "exports" ||
      edge.type === "references")
  );
}
