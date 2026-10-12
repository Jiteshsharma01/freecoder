export type ProjectType =
  | "nextjs"
  | "react"
  | "javascript"
  | "typescript"
  | "php"
  | "generic";

export interface ProjectFile {
  path: string;
  name: string;
  extension: string;
  category:
    | "source"
    | "test"
    | "config"
    | "asset"
    | "documentation"
    | "generated"
    | "other";
}

export interface ProjectDirectory {
  path: string;
  name: string;
}

export interface ProjectAnalysis {
  rootPath: string;
  projectType: ProjectType;
  framework?: string;
  frameworkVersion?: string;
  language: string[];
  technologies: string[];
  files: ProjectFile[];
  directories: ProjectDirectory[];
  entryPoints: string[];
  configs: string[];
  tests: string[];
  assets: string[];
}
