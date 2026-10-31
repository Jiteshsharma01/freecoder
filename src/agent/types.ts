export type AgentScope = "file" | "related" | "project";

export type AgentTaskStatus =
  | "planning"
  | "review"
  | "generating"
  | "diff"
  | "applying"
  | "completed"
  | "cancelled"
  | "failed";

export interface AgentTask {
  id: string;
  modelId: string;
  instruction: string;
  scope: AgentScope;
  currentFile?: string;
  targetFiles: string[];
  context: AgentContext;
  changes: FileChange[];
  status: AgentTaskStatus;
  modelSnapshot?: AgentModelSnapshot;
  undone?: boolean;
}

export interface ProjectReference {
  path: string;
  line: number;
  preview: string;
}

export interface AgentContext {
  currentFile?: FileContext;
  relatedFiles: FileContext[];
  referencedFiles?: FileContext[];
  projectSummary?: string;
  graphContext?: GraphContext;
  projectReferences?: ProjectReference[];
  selectedFilePath?: string;
  candidateFiles?: string[];
}

export interface FileContext {
  path: string;
  content: string;
  language?: string;
}

export interface GraphContext {
  dependencies: string[];
  dependents: string[];
}

export interface AgentModelSnapshot {
  resolver: string;
  planner: string;
  changeGenerator: string;
}

export interface FileChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  originalPath?: string;
  newPath?: string;
  /**
   * Content of the file before the proposed change.
   * Used to protect against the file changing
   * between review and apply.
   */
  originalContent?: string;
  /**
   * Complete proposed file content.
   * For delete operations this is undefined.
   */
  newContent?: string;
  /*
   * Snapshot of what actually exists in the workspace
   * immediately after the Agent applied the change.
   * Used only for safe Undo verification.
   */
  appliedContent?: string;
  explanation?: string;
}
