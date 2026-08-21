export type KnowledgeNodeType = 'file';

export type KnowledgeEdgeType =
    | 'imports'
    | 'exports'
    | 'references';

export interface KnowledgeGraphNode {
    id: string;
    label: string;
    type: KnowledgeNodeType;
    path: string;
}

export interface KnowledgeGraphEdge {
    id: string;
    source: string;
    target: string;
    type: KnowledgeEdgeType;
}

export interface KnowledgeGraph {
    version: string;
    generatedAt: string;
    workspaceRoot: string;
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
}