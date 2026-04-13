/**
 * MiniMax auth resolver
 *
 * Resolves MiniMax credentials from trusted env vars, trusted user/global
 * OpenCode config, and auth.json fallback into the standardized shape used
 * by the MiniMax Coding Plan provider.
 */

import {
  extractProviderOptionsApiKey,
  getApiKeyCheckedPaths,
  getFirstAuthEntryValue,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKeyFromEnvAndConfig,
} from "./api-key-resolver.js";
import type { AuthData, MiniMaxAuthData } from "./types.js";
import { sanitizeDisplayText } from "./display-sanitize.js";
import { getAuthPaths, readAuthFileCached } from "./opencode-auth.js";

export const DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS = 5_000;
const MINIMAX_AUTH_KEYS = ["minimax-coding-plan"] as const;
const MINIMAX_PROVIDER_KEYS = ["minimax-coding-plan", "minimax"] as const;
const ALLOWED_MINIMAX_ENV_VARS = ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"] as const;

export type MiniMaxKeySource =
  | "env:MINIMAX_CODING_PLAN_API_KEY"
  | "env:MINIMAX_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedMiniMaxAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

export type MiniMaxAuthDiagnostics =
  | {
      state: "none";
      source: null;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "configured";
      source: MiniMaxKeySource;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "invalid";
      source: "auth.json";
      checkedPaths: string[];
      authPaths: string[];
      error: string;
    };

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

function getMiniMaxAuthEntry(auth: AuthData | null | undefined): unknown {
  return getFirstAuthEntryValue(auth, MINIMAX_AUTH_KEYS);
}

function isMiniMaxAuthData(value: unknown): value is MiniMaxAuthData {
  return value !== null && typeof value === "object";
}

function getMiniMaxCredential(auth: MiniMaxAuthData): string {
  const key = typeof auth.key === "string" ? auth.key.trim() : "";
  const access = typeof auth.access === "string" ? auth.access.trim() : "";
  return key || access || "";
}

function sanitizeMiniMaxAuthValue(value: string): string {
  const sanitized = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, 120);
}

/**
 * Resolve MiniMax auth from the full auth data.
 *
 * Returns `"none"` when no minimax-coding-plan entry exists,
 * `"invalid"` when the entry exists but has wrong type or empty credentials,
 * and `"configured"` when a usable API key is found.
 */
export function resolveMiniMaxAuth(auth: AuthData | null | undefined): ResolvedMiniMaxAuth {
  const minimax = getMiniMaxAuthEntry(auth);
  if (minimax === null || minimax === undefined) {
    return { state: "none" };
  }

  if (!isMiniMaxAuthData(minimax)) {
    return { state: "invalid", error: "MiniMax auth entry has invalid shape" };
  }

  if (typeof minimax.type !== "string") {
    return { state: "invalid", error: "MiniMax auth entry present but type is missing or invalid" };
  }

  if (minimax.type !== "api") {
    return {
      state: "invalid",
      error: `Unsupported MiniMax auth type: "${sanitizeMiniMaxAuthValue(minimax.type)}"`,
    };
  }

  const credential = getMiniMaxCredential(minimax);
  if (!credential) {
    return { state: "invalid", error: "MiniMax auth entry present but credentials are empty" };
  }

  return { state: "configured", apiKey: credential };
}

async function resolveMiniMaxAuthWithSource(params?: {
  maxAgeMs?: number;
}): Promise<{ auth: ResolvedMiniMaxAuth; source: MiniMaxKeySource | null }> {
  const resolvedFromEnvOrConfig = await resolveApiKeyFromEnvAndConfig<MiniMaxKeySource>({
    envVars: [
      {
        name: "MINIMAX_CODING_PLAN_API_KEY",
        source: "env:MINIMAX_CODING_PLAN_API_KEY",
      },
      { name: "MINIMAX_API_KEY", source: "env:MINIMAX_API_KEY" },
    ],
    extractFromConfig: (config) =>
      extractProviderOptionsApiKey(config, {
        providerKeys: MINIMAX_PROVIDER_KEYS,
        allowedEnvVars: ALLOWED_MINIMAX_ENV_VARS,
      }),
    configJsonSource: "opencode.json",
    configJsoncSource: "opencode.jsonc",
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });

  if (resolvedFromEnvOrConfig) {
    return {
      auth: { state: "configured", apiKey: resolvedFromEnvOrConfig.key },
      source: resolvedFromEnvOrConfig.source,
    };
  }

  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS);
  const authData = await readAuthFileCached({
    maxAgeMs,
  });
  const auth = resolveMiniMaxAuth(authData);

  return {
    auth,
    source: auth.state === "none" ? null : "auth.json",
  };
}

export async function resolveMiniMaxAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedMiniMaxAuth> {
  return (await resolveMiniMaxAuthWithSource(params)).auth;
}

export async function getMiniMaxAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<MiniMaxAuthDiagnostics> {
  const { auth, source } = await resolveMiniMaxAuthWithSource(params);
  const checkedPaths = getApiKeyCheckedPaths({
    envVarNames: [...ALLOWED_MINIMAX_ENV_VARS],
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
  const authPaths = getAuthPaths();

  if (auth.state === "none") {
    return {
      state: "none",
      source: null,
      checkedPaths,
      authPaths,
    };
  }

  if (auth.state === "invalid") {
    return {
      state: "invalid",
      source: "auth.json",
      checkedPaths,
      authPaths,
      error: auth.error,
    };
  }

  return {
    state: "configured",
    source: source ?? "auth.json",
    checkedPaths,
    authPaths,
  };
}
