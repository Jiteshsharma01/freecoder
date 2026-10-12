import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type FreeCopilotModelRole =
  | "chat"
  | "edit"
  | "apply"
  | "resolver"
  | "planner"
  | "changeGenerator"
  | "embed";

export interface FreeCopilotModelOptions {
  [key: string]: unknown;
}

export interface FreeCopilotModel {
  name: string;
  provider: string;
  model: string;
  apiBase?: string;
  roles?: FreeCopilotModelRole[];
  options?: FreeCopilotModelOptions;
}

export interface FreeCopilotConfig {
  name: string;
  version: string;
  schema: string;
  models: FreeCopilotModel[];
}

export const FREECOPILOT_CONFIG_DIR = path.join(os.homedir(), ".freecopilot");

export const FREECOPILOT_CONFIG_FILE = path.join(
  FREECOPILOT_CONFIG_DIR,
  "config.yaml",
);

function isFreeCopilotModelRole(value: unknown): value is FreeCopilotModelRole {
  return (
    value === "chat" ||
    value === "edit" ||
    value === "apply" ||
    value === "resolver" ||
    value === "planner" ||
    value === "changeGenerator" ||
    value === "embed"
  );
}

export const DEFAULT_FREECOPILOT_CONFIG: FreeCopilotConfig = {
  name: "Main Config",
  version: "1.0.0",
  schema: "v1",
  models: [
    {
      name: "Qwen 3",
      provider: "ollama",
      model: "qwen3-coder:30b",
      apiBase: "http://localhost:11434",
      roles: [
        "chat",
        "edit",
        "apply",
        "resolver",
        "planner",
        "changeGenerator",
      ],
    },
  ],
};

export async function ensureFreeCopilotConfig(): Promise<string> {
  await fs.mkdir(FREECOPILOT_CONFIG_DIR, {
    recursive: true,
  });

  try {
    await fs.access(FREECOPILOT_CONFIG_FILE);
  } catch {
    await fs.writeFile(
      FREECOPILOT_CONFIG_FILE,
      stringifyYaml(DEFAULT_FREECOPILOT_CONFIG),
      "utf8",
    );
  }

  return FREECOPILOT_CONFIG_FILE;
}

export async function loadFreeCopilotConfig(): Promise<FreeCopilotConfig> {
  const configFile = await ensureFreeCopilotConfig();
  const raw = await fs.readFile(configFile, "utf8");

  let parsed: unknown;

  try {
    parsed = parseYaml(raw);
  } catch (error: any) {
    throw new Error(
      `Failed to parse FreeCopilot config.yaml: ${
        error?.message ?? "Invalid YAML"
      }`,
    );
  }

  return validateFreeCopilotConfig(parsed);
}

export function validateFreeCopilotConfig(value: unknown): FreeCopilotConfig {
  if (!value || typeof value !== "object") {
    throw new Error("FreeCopilot config.yaml must contain a YAML object.");
  }

  const data = value as Record<string, unknown>;

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new Error("FreeCopilot config.yaml requires a non-empty 'name'.");
  }

  if (typeof data.version !== "string" || !data.version.trim()) {
    throw new Error("FreeCopilot config.yaml requires a non-empty 'version'.");
  }

  if (typeof data.schema !== "string" || !data.schema.trim()) {
    throw new Error("FreeCopilot config.yaml requires a non-empty 'schema'.");
  }

  if (!Array.isArray(data.models)) {
    throw new Error("FreeCopilot config.yaml requires a 'models' array.");
  }

  const models = data.models.map((model, index) =>
    validateFreeCopilotModel(model, index),
  );

  if (models.length === 0) {
    throw new Error("FreeCopilot config.yaml must contain at least one model.");
  }

  return {
    name: data.name.trim(),
    version: data.version.trim(),
    schema: data.schema.trim(),
    models,
  };
}

function validateFreeCopilotModel(
  value: unknown,
  index: number,
): FreeCopilotModel {
  if (!value || typeof value !== "object") {
    throw new Error(`FreeCopilot model at index ${index} must be an object.`);
  }

  const data = value as Record<string, unknown>;
  const modelNumber = index + 1;

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new Error(
      `FreeCopilot model #${modelNumber} requires a non-empty 'name'.`,
    );
  }

  if (typeof data.provider !== "string" || !data.provider.trim()) {
    throw new Error(
      `FreeCopilot model #${modelNumber} requires a non-empty 'provider'.`,
    );
  }

  if (typeof data.model !== "string" || !data.model.trim()) {
    throw new Error(
      `FreeCopilot model #${modelNumber} requires a non-empty 'model'.`,
    );
  }

  if (data.apiBase !== undefined && typeof data.apiBase !== "string") {
    throw new Error(
      `FreeCopilot model #${modelNumber} has an invalid 'apiBase'.`,
    );
  }

  if (data.roles !== undefined && !Array.isArray(data.roles)) {
    throw new Error(
      `FreeCopilot model #${modelNumber} has an invalid 'roles' value.`,
    );
  }

  const roles = Array.isArray(data.roles)
    ? data.roles.map((role) => {
        if (!isFreeCopilotModelRole(role)) {
          throw new Error(
            `FreeCopilot model #${modelNumber} contains an unsupported model role: ${String(
              role,
            )}.`,
          );
        }

        return role;
      })
    : undefined;

  if (
    data.options !== undefined &&
    (typeof data.options !== "object" ||
      data.options === null ||
      Array.isArray(data.options))
  ) {
    throw new Error(
      `FreeCopilot model #${modelNumber} has an invalid 'options' value.`,
    );
  }

  return {
    name: data.name.trim(),
    provider: data.provider.trim(),
    model: data.model.trim(),
    apiBase: typeof data.apiBase === "string" ? data.apiBase.trim() : undefined,
    roles,
    options: data.options as FreeCopilotModelOptions | undefined,
  };
}

export function getFreeCopilotModelId(model: FreeCopilotModel): string {
  return [model.provider, model.model].join(":").toLowerCase();
}
