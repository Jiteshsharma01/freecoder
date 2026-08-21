import * as fs from "fs/promises";
import * as path from "path";
import { ProjectType } from "./types";

export interface ProjectDetection {
  projectType: ProjectType;
  framework?: string;
  frameworkVersion?: string;
  language: string[];
  technologies: string[];
}

export async function detectProject(
  rootPath: string,
): Promise<ProjectDetection> {
  const packageJsonPath = path.join(rootPath, "package.json");
  let packageJson: any = null;
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  } catch {
    // package.json doesn't exist
  }

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if (dependencies.next) {
    return {
      projectType: "nextjs",
      framework: "Next.js",
      frameworkVersion: dependencies.next,
      language: detectJsLanguages(dependencies),
      technologies: [
        "Next.js",
        "React",
        ...detectExtraTechnologies(dependencies),
      ],
    };
  }

  if (dependencies.react) {
    return {
      projectType: "react",
      framework: "React",
      frameworkVersion: dependencies.react,
      language: detectJsLanguages(dependencies),
      technologies: ["React", ...detectExtraTechnologies(dependencies)],
    };
  }

  if (dependencies.typescript) {
    return {
      projectType: "typescript",
      language: ["TypeScript"],
      technologies: ["TypeScript", ...detectExtraTechnologies(dependencies)],
    };
  }

  const hasPhp = await hasFileWithExtension(rootPath, ".php");

  if (hasPhp) {
    return {
      projectType: "php",
      language: ["PHP"],
      technologies: ["PHP"],
    };
  }

  return {
    projectType: "generic",
    language: [],
    technologies: [],
  };
}

function detectJsLanguages(dependencies: Record<string, string>): string[] {
  if (dependencies.typescript) {
    return ["TypeScript", "JavaScript"];
  }
  return ["JavaScript"];
}

function detectExtraTechnologies(
  dependencies: Record<string, string>,
): string[] {
  const technologies: string[] = [];

  if (dependencies.tailwindcss) {
    technologies.push("Tailwind CSS");
  }
  if (dependencies.jest) {
    technologies.push("Jest");
  }
  if (dependencies.vitest) {
    technologies.push("Vitest");
  }
  if (dependencies.zustand) {
    technologies.push("Zustand");
  }
  if (dependencies.redux || dependencies["@reduxjs/toolkit"]) {
    technologies.push("Redux");
  }
  return technologies;
}

async function hasFileWithExtension(
  rootPath: string,
  extension: string,
): Promise<boolean> {
  async function traverse(directory: string): Promise<boolean> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        ["node_modules", ".git", "vendor", ".next", "dist", "build"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await traverse(fullPath)) {
          return true;
        }
        continue;
      }

      if (path.extname(entry.name).toLowerCase() === extension) {
        return true;
      }
    }
    return false;
  }
  return traverse(rootPath);
}

// This is where you can later add: Laravel, Symfony, WordPress, Vue, Angular, Svelte, Express, NestJS, Django, Flask, Rails, Spring, .NET, etc.
