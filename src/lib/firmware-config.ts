/**
 * Firmware API key configuration resolver
 *
 * Resolution priority (first wins):
 * 1. Environment variable: FIRMWARE_AI_API_KEY or FIRMWARE_API_KEY
 * 2. User/global opencode.json/opencode.jsonc: provider.firmware.options.apiKey
 *    - Supports {env:VAR_NAME} syntax for environment variable references
 * 3. auth.json: firmware.key (legacy/fallback)
 */

import { resolveEnvTemplate } from "./env-template.js";
import { readAuthFile } from "./opencode-auth.js";
import {
  resolveApiKey,
  getApiKeyDiagnostics,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";

/** Result of firmware API key resolution */
export interface FirmwareApiKeyResult {
  key: string;
  source: FirmwareKeySource;
}

const ALLOWED_FIRMWARE_ENV_VARS = ["FIRMWARE_AI_API_KEY", "FIRMWARE_API_KEY"] as const;

/** Source of the resolved API key */
export type FirmwareKeySource =
  | "env:FIRMWARE_AI_API_KEY"
  | "env:FIRMWARE_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

/**
 * Extract firmware API key from trusted opencode config object
 *
 * Looks for: provider.firmware.options.apiKey
 */
function extractFirmwareKeyFromConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;

  const root = config as Record<string, unknown>;
  const provider = root.provider;
  if (!provider || typeof provider !== "object") return null;

  const firmware = (provider as Record<string, unknown>).firmware;
  if (!firmware || typeof firmware !== "object") return null;

  const options = (firmware as Record<string, unknown>).options;
  if (!options || typeof options !== "object") return null;

  const apiKey = (options as Record<string, unknown>).apiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;

  // Resolve {env:VAR_NAME} syntax
  return resolveEnvTemplate(apiKey.trim(), ALLOWED_FIRMWARE_ENV_VARS);
}

/**
 * Extract firmware API key from auth.json
 */
function extractFirmwareKeyFromAuth(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;
  const fw = (auth as Record<string, unknown>).firmware as
    | { type?: string; key?: string }
    | undefined;
  if (fw && fw.type === "api" && fw.key && fw.key.trim().length > 0) {
    return fw.key.trim();
  }
  return null;
}

// Re-export for consumers that need path info
export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

/**
 * Resolve Firmware API key from all available sources.
 *
 * Priority (first wins):
 * 1. Environment variable: FIRMWARE_AI_API_KEY or FIRMWARE_API_KEY
 * 2. User/global opencode.json/opencode.jsonc: provider.firmware.options.apiKey
 * 3. auth.json: firmware.key
 *
 * @returns API key and source, or null if not found
 */
export async function resolveFirmwareApiKey(): Promise<FirmwareApiKeyResult | null> {
  return resolveApiKey<FirmwareKeySource>(
    {
      envVars: [
        { name: "FIRMWARE_AI_API_KEY", source: "env:FIRMWARE_AI_API_KEY" },
        { name: "FIRMWARE_API_KEY", source: "env:FIRMWARE_API_KEY" },
      ],
      extractFromConfig: extractFirmwareKeyFromConfig,
      configJsonSource: "opencode.json",
      configJsoncSource: "opencode.jsonc",
      extractFromAuth: extractFirmwareKeyFromAuth,
      authSource: "auth.json",
      getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    },
    readAuthFile,
  );
}

/**
 * Check if a Firmware API key is configured in any source
 */
export async function hasFirmwareApiKey(): Promise<boolean> {
  const result = await resolveFirmwareApiKey();
  return result !== null;
}

/**
 * Get diagnostic info about firmware API key configuration
 */
export async function getFirmwareKeyDiagnostics(): Promise<{
  configured: boolean;
  source: FirmwareKeySource | null;
  checkedPaths: string[];
}> {
  return getApiKeyDiagnostics<FirmwareKeySource>({
    envVarNames: ["FIRMWARE_AI_API_KEY", "FIRMWARE_API_KEY"],
    resolve: resolveFirmwareApiKey,
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
}
