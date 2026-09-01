import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";

export type ValidationStatus = "passed" | "failed" | "skipped";

export interface ValidationResult {
  status: ValidationStatus;

  type: "typescript" | "lint" | "test";

  command?: string;

  exitCode?: number;

  output: string;

  durationMs: number;

  reason?: string;
}

export interface ProjectValidationResult {
  status: "passed" | "failed" | "skipped";

  results: ValidationResult[];

  summary: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

interface ValidationCommand {
  type: "typescript" | "lint" | "test";

  command: string;

  args: string[];
}

/**
 * Runs the safest available project validation commands.
 *
 * The function intentionally uses scripts already declared
 * by the project instead of assuming a specific framework.
 */
export async function validateProject(
  rootPath: string,
): Promise<ProjectValidationResult> {
  const packageJson = await readPackageJson(rootPath);

  /*
   * No package.json means this may be a non-JavaScript
   * project such as PHP. Do not fail just because the
   * JS validation tools are unavailable.
   */
  if (!packageJson) {
    return {
      status: "skipped",
      results: [],
      summary:
        "No package.json was found. JavaScript/TypeScript validation was skipped.",
    };
  }

  const commands = buildValidationCommands(packageJson);

  if (commands.length === 0) {
    return {
      status: "skipped",
      results: [],
      summary:
        "No TypeScript, lint, or test scripts were available in package.json.",
    };
  }

  const results: ValidationResult[] = [];

  for (const validationCommand of commands) {
    const start = Date.now();

    try {
      const result = await runCommand(
        validationCommand.command,
        validationCommand.args,
        rootPath,
      );

      const durationMs = Date.now() - start;

      results.push({
        type: validationCommand.type,

        status: result.exitCode === 0 ? "passed" : "failed",

        command: [validationCommand.command, ...validationCommand.args].join(
          " ",
        ),

        exitCode: result.exitCode,

        output: result.output,

        durationMs,
      });

      /*
       * Stop after the first failure.
       *
       * There is little value in running tests after
       * TypeScript or lint already failed, and it can
       * produce a lot of noisy output.
       */
      if (result.exitCode !== 0) {
        break;
      }
    } catch (error: any) {
      results.push({
        type: validationCommand.type,

        status: "failed",

        command: [validationCommand.command, ...validationCommand.args].join(
          " ",
        ),

        output: error?.message ?? "Validation command failed.",

        durationMs: Date.now() - start,
      });

      break;
    }
  }

  const failed = results.some((result) => result.status === "failed");

  const skipped = results.length === 0;

  if (failed) {
    return {
      status: "failed",

      results,

      summary: buildValidationSummary(results),
    };
  }

  if (skipped) {
    return {
      status: "skipped",

      results,

      summary: "No project validation commands were executed.",
    };
  }

  return {
    status: "passed",

    results,

    summary: buildValidationSummary(results),
  };
}

async function readPackageJson(rootPath: string): Promise<PackageJson | null> {
  const packagePath = path.join(rootPath, "package.json");

  try {
    const content = await fs.readFile(packagePath, "utf8");

    const parsed = JSON.parse(content) as PackageJson;

    return parsed;
  } catch {
    return null;
  }
}

function buildValidationCommands(
  packageJson: PackageJson,
): ValidationCommand[] {
  const scripts = packageJson.scripts ?? {};

  const commands: ValidationCommand[] = [];

  /*
   * TypeScript
   *
   * Prefer a project-local script if one exists.
   */
  if (scripts.typecheck) {
    commands.push({
      type: "typescript",

      command: "npm",

      args: ["run", "typecheck"],
    });
  } else if (scripts["type-check"]) {
    commands.push({
      type: "typescript",

      command: "npm",

      args: ["run", "type-check"],
    });
  } else if (scripts.tsc) {
    commands.push({
      type: "typescript",

      command: "npm",

      args: ["run", "tsc"],
    });
  }

  /*
   * Lint
   */
  if (scripts.lint) {
    commands.push({
      type: "lint",

      command: "npm",

      args: ["run", "lint"],
    });
  }

  /*
   * Test
   *
   * Prefer the project's normal test script.
   */
  if (scripts.test) {
    commands.push({
      type: "test",

      command: "npm",

      args: ["run", "test", "--", "--runInBand"],
    });
  }

  return commands;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{
  exitCode: number;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",

      env: process.env,

      windowsHide: true,
    });

    let output = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      output += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,

        output: output.trim(),
      });
    });
  });
}

function buildValidationSummary(results: ValidationResult[]): string {
  if (results.length === 0) {
    return "No validation commands were executed.";
  }

  return results
    .map((result) => {
      const icon =
        result.status === "passed"
          ? "✅"
          : result.status === "failed"
            ? "❌"
            : "⏭️";

      const duration = `${(result.durationMs / 1000).toFixed(1)}s`;

      return [
        `${icon} ${capitalize(result.type)}`,
        result.command ? `  Command: ${result.command}` : "",
        `  Duration: ${duration}`,
        result.reason ? `  ${result.reason}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
