/**
 * Z.ai quota fetcher
 *
 * Uses OpenCode's auth.json (zai-coding-plan) and queries:
 * https://api.z.ai/api/monitor/usage/quota/limit
 */

import { clampPercent } from "./format-utils.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { readAuthFile } from "./opencode-auth.js";
import type {
  ZaiResult,
  ZaiAuthData,
  ZaiQuotaResponse,
} from "./types.js";

async function readZaiAuth(): Promise<ZaiAuthData | null> {
  const auth = await readAuthFile();
  const zai = auth?.["zai-coding-plan"];
  if (!zai || zai.type !== "api" || !zai.key) return null;
  return zai as ZaiAuthData;
}

const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

export async function queryZaiQuota(): Promise<ZaiResult> {
  const auth = await readZaiAuth();
  if (!auth) return null;

  try {
    const headers: Record<string, string> = {
      Authorization: auth.key,
      "User-Agent": "OpenCode-Quota-Toast/1.0",
      "Content-Type": "application/json",
    };

    const resp = await fetchWithTimeout(ZAI_QUOTA_URL, { headers });
    if (!resp.ok) {
      const text = await resp.text();
      return {
        success: false,
        error: `Z.ai API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
      };
    }

    const data = (await resp.json()) as ZaiQuotaResponse;
    const limits = data.data.limits;

    if (!limits || !Array.isArray(limits)) {
      return { success: false, error: "Invalid quota data" };
    }

    let hourlyWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;
    let weeklyWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;
    let mcpWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;

    for (const limit of limits) {
      const percentRemaining = clampPercent(100 - limit.percentage);
      let resetTimeIso: string | undefined;

      if (limit.nextResetTime) {
        const ms = Math.round(limit.nextResetTime);
        if (Number.isFinite(ms) && ms > 0) {
          resetTimeIso = new Date(ms).toISOString();
        }
      }

      const window = { percentRemaining, resetTimeIso };

      if (limit.type === "TOKENS_LIMIT") {
        if (limit.unit === 3) {
          // unit 3 is 5-hourly (Standard Lite/Pro/Max window)
          hourlyWindow = window;
        } else if (limit.unit === 4 || limit.unit === 6) {
          // unit 6 is weekly, unit 4 is daily. We prioritize the longer one as Weekly for display parity.
          weeklyWindow = window;
        }
      } else if (limit.type === "TIME_LIMIT") {
        // TIME_LIMIT (unit 5) is typically the Monthly MCP limit
        mcpWindow = window;
      }
    }

    return {
      success: true,
      label: "Z.ai",
      windows: {
        hourly: hourlyWindow,
        weekly: weeklyWindow,
        mcp: mcpWindow,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}
