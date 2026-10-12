import * as fs from "fs/promises";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  FREECOPILOT_CONFIG_DIR,
  FREECOPILOT_CONFIG_FILE,
  FreeCopilotConfig,
  loadFreeCopilotConfig,
  validateFreeCopilotConfig,
} from "./modelConfig";

export interface FreeCopilotConfigInfo {
  name: string;
  fileName: string;
  filePath: string;
}

const SUPPORTED_CONFIG_EXTENSIONS = new Set([".yaml", ".yml"]);

export async function listFreeCopilotConfigs(): Promise<
  FreeCopilotConfigInfo[]
> {
  await fs.mkdir(FREECOPILOT_CONFIG_DIR, { recursive: true });

  const entries = await fs.readdir(FREECOPILOT_CONFIG_DIR, {
    withFileTypes: true,
  });

  const configs: FreeCopilotConfigInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!SUPPORTED_CONFIG_EXTENSIONS.has(extension)) {
      continue;
    }

    const filePath = path.join(FREECOPILOT_CONFIG_DIR, entry.name);

    try {
      const raw = await fs.readFile(filePath, "utf8");

      const config = validateFreeCopilotConfig(parseYaml(raw));

      configs.push({
        name: config.name,
        fileName: entry.name,
        filePath,
      });
    } catch (error) {
      console.warn(
        `[FreeCopilot] Skipping invalid config "${entry.name}":`,
        error,
      );
    }
  }

  return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadFreeCopilotConfigFile(
  filePath: string,
): Promise<FreeCopilotConfig> {
  const normalizedPath = path.resolve(filePath);

  const configDirectory = path.resolve(FREECOPILOT_CONFIG_DIR);

  if (
    normalizedPath !== path.resolve(FREECOPILOT_CONFIG_FILE) &&
    !normalizedPath.startsWith(`${configDirectory}${path.sep}`)
  ) {
    throw new Error(
      "FreeCopilot configuration files must be inside ~/.freecopilot.",
    );
  }

  const raw = await fs.readFile(normalizedPath, "utf8");

  return validateFreeCopilotConfig(parseYaml(raw));
}

export async function createFreeCopilotConfig(
  fileName: string,
  config: FreeCopilotConfig,
): Promise<string> {
  const safeFileName = normalizeConfigFileName(fileName);

  const filePath = path.join(FREECOPILOT_CONFIG_DIR, safeFileName);

  await fs.writeFile(filePath, stringifyYaml(config), "utf8");

  return filePath;
}

export async function ensureMainConfig(): Promise<string> {
  await fs.mkdir(FREECOPILOT_CONFIG_DIR, { recursive: true });

  await loadFreeCopilotConfig();

  return FREECOPILOT_CONFIG_FILE;
}

function normalizeConfigFileName(fileName: string): string {
  const trimmed = fileName.trim();

  if (!trimmed) {
    throw new Error("Config file name cannot be empty.");
  }

  const baseName = path.basename(trimmed);

  if (baseName !== trimmed) {
    throw new Error("Config file name must not contain a directory path.");
  }

  const extension = path.extname(baseName).toLowerCase();

  if (!SUPPORTED_CONFIG_EXTENSIONS.has(extension)) {
    return `${baseName}.yaml`;
  }

  return baseName;
}
