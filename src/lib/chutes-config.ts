/**
 * Chutes API key configuration resolver
 *
 * Resolution priority (first wins):
 * 1. Environment variable: CHUTES_API_KEY
 * 2. User/global opencode.json/opencode.jsonc: provider.chutes.options.apiKey
 *    - Supports {env:VAR_NAME} syntax for environment variable references
 * 3. auth.json: chutes.key (legacy/fallback)
 */

import { resolveEnvTemplate } from "./env-template.js";
import { readAuthFile } from "./opencode-auth.js";
import {
  resolveApiKey,
  getApiKeyDiagnostics,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";

/** Result of Chutes API key resolution */
export interface ChutesApiKeyResult {
  key: string;
  source: ChutesKeySource;
}

const ALLOWED_CHUTES_ENV_VARS = ["CHUTES_API_KEY"] as const;

/** Source of the resolved API key */
export type ChutesKeySource =
  | "env:CHUTES_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

/**
 * Extract Chutes API key from trusted opencode config object
 *
 * Looks for: provider.chutes.options.apiKey
 */
function extractChutesKeyFromConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;

  const root = config as Record<string, unknown>;
  const provider = root.provider;
  if (!provider || typeof provider !== "object") return null;

  const chutes = (provider as Record<string, unknown>).chutes;
  if (!chutes || typeof chutes !== "object") return null;

  const options = (chutes as Record<string, unknown>).options;
  if (!options || typeof options !== "object") return null;

  const apiKey = (options as Record<string, unknown>).apiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;

  return resolveEnvTemplate(apiKey.trim(), ALLOWED_CHUTES_ENV_VARS);
}

/**
 * Extract Chutes API key from auth.json
 */
function extractChutesKeyFromAuth(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;
  const chutes = (auth as Record<string, unknown>).chutes as
    | { type?: string; key?: string }
    | undefined;
  if (chutes && chutes.type === "api" && chutes.key && chutes.key.trim().length > 0) {
    return chutes.key.trim();
  }
  return null;
}

// Re-export for consumers that need path info
export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

/**
 * Resolve Chutes API key from all available sources.
 *
 * Priority (first wins):
 * 1. Environment variable: CHUTES_API_KEY
 * 2. User/global opencode.json/opencode.jsonc: provider.chutes.options.apiKey
 * 3. auth.json: chutes.key
 *
 * @returns API key and source, or null if not found
 */
export async function resolveChutesApiKey(): Promise<ChutesApiKeyResult | null> {
  return resolveApiKey<ChutesKeySource>(
    {
      envVars: [{ name: "CHUTES_API_KEY", source: "env:CHUTES_API_KEY" }],
      extractFromConfig: extractChutesKeyFromConfig,
      configJsonSource: "opencode.json",
      configJsoncSource: "opencode.jsonc",
      extractFromAuth: extractChutesKeyFromAuth,
      authSource: "auth.json",
      getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    },
    readAuthFile,
  );
}

/**
 * Check if a Chutes API key is configured
 */
export async function hasChutesApiKey(): Promise<boolean> {
  const result = await resolveChutesApiKey();
  return result !== null;
}

/**
 * Get diagnostic info about Chutes API key configuration
 */
export async function getChutesKeyDiagnostics(): Promise<{
  configured: boolean;
  source: ChutesKeySource | null;
  checkedPaths: string[];
}> {
  return getApiKeyDiagnostics<ChutesKeySource>({
    envVarNames: ["CHUTES_API_KEY"],
    resolve: resolveChutesApiKey,
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
}
