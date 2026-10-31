import * as fs from "fs/promises";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  FREECODER_CONFIG_DIR,
  FREECODER_CONFIG_FILE,
  FreeCoderConfig,
  loadFreeCoderConfig,
  validateFreeCoderConfig,
} from "./modelConfig";

export interface FreeCoderConfigInfo {
  name: string;
  fileName: string;
  filePath: string;
}

const SUPPORTED_CONFIG_EXTENSIONS = new Set([".yaml", ".yml"]);

export async function listFreeCoderConfigs(): Promise<
  FreeCoderConfigInfo[]
> {
  await fs.mkdir(FREECODER_CONFIG_DIR, { recursive: true });

  const entries = await fs.readdir(FREECODER_CONFIG_DIR, {
    withFileTypes: true,
  });

  const configs: FreeCoderConfigInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!SUPPORTED_CONFIG_EXTENSIONS.has(extension)) {
      continue;
    }

    const filePath = path.join(FREECODER_CONFIG_DIR, entry.name);

    try {
      const raw = await fs.readFile(filePath, "utf8");

      const config = validateFreeCoderConfig(parseYaml(raw));

      configs.push({
        name: config.name,
        fileName: entry.name,
        filePath,
      });
    } catch (error) {
      console.warn(
        `[FreeCoder] Skipping invalid config "${entry.name}":`,
        error,
      );
    }
  }

  return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadFreeCoderConfigFile(
  filePath: string,
): Promise<FreeCoderConfig> {
  const normalizedPath = path.resolve(filePath);

  const configDirectory = path.resolve(FREECODER_CONFIG_DIR);

  if (
    normalizedPath !== path.resolve(FREECODER_CONFIG_FILE) &&
    !normalizedPath.startsWith(`${configDirectory}${path.sep}`)
  ) {
    throw new Error(
      "FreeCoder configuration files must be inside ~/.freecoder.",
    );
  }

  const raw = await fs.readFile(normalizedPath, "utf8");

  return validateFreeCoderConfig(parseYaml(raw));
}

export async function createFreeCoderConfig(
  fileName: string,
  config: FreeCoderConfig,
): Promise<string> {
  const safeFileName = normalizeConfigFileName(fileName);

  const filePath = path.join(FREECODER_CONFIG_DIR, safeFileName);

  await fs.writeFile(filePath, stringifyYaml(config), "utf8");

  return filePath;
}

export async function ensureMainConfig(): Promise<string> {
  await fs.mkdir(FREECODER_CONFIG_DIR, { recursive: true });

  await loadFreeCoderConfig();

  return FREECODER_CONFIG_FILE;
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
