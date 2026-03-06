/**
 * Verbose quota status formatter for /quota.
 *
 * This is intentionally more verbose than the toast:
 * - Always shows reset countdown when available
 * - Uses one line per limit, grouped under provider headers
 * - Includes session token summary (input/output per model)
 */

import type { QuotaToastEntry, QuotaToastError, SessionTokensData } from "./entries.js";
import { isValueEntry } from "./entries.js";
import { bar, clampInt, padRight } from "./format-utils.js";
import { formatGroupedHeader } from "./grouped-header-format.js";
import { normalizeGroupedQuotaEntries } from "./grouped-entry-normalization.js";
import { renderSessionTokensLines } from "./session-tokens-format.js";

/**
 * Format reset time in compact form (different from toast countdown).
 * Uses seconds/minutes/hours/days format for /quota command.
 */
function formatResetTimeSeconds(diffSeconds: number): string {
  if (!Number.isFinite(diffSeconds) || diffSeconds <= 0) return "now";
  if (diffSeconds < 60) return `${Math.ceil(diffSeconds)}s`;
  if (diffSeconds < 3600) return `${Math.ceil(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h`;
  return `${Math.round(diffSeconds / 86400)}d`;
}

function formatResetsIn(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSeconds = (t - Date.now()) / 1000;
  return ` (resets in ${formatResetTimeSeconds(diffSeconds)})`;
}

function getGroupedLeftText(entry: QuotaToastEntry): string {
  const label = (entry.label ?? entry.name).trim();
  const right = entry.right?.trim();
  return right ? `${label} ${right}` : label;
}

export function formatQuotaCommand(params: {
  entries: QuotaToastEntry[];
  errors: QuotaToastError[];
  sessionTokens?: SessionTokensData;
}): string {
  const entries = normalizeGroupedQuotaEntries(params.entries, "quota");

  const groupOrder: string[] = [];
  const groups = new Map<string, QuotaToastEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.group);
    if (list) list.push(e);
    else {
      groupOrder.push(e.group);
      groups.set(e.group, [e]);
    }
  }

  const lines: string[] = [];
  lines.push("# Quota (/quota)");

  const barWidth = 18;
  const leftCol = Math.max(
    16,
    Math.min(
      30,
      entries.reduce((max, entry) => Math.max(max, getGroupedLeftText(entry).length), 0),
    ),
  );

  for (let i = 0; i < groupOrder.length; i++) {
    const g = groupOrder[i]!;
    const list = groups.get(g) ?? [];

    if (i > 0) lines.push("");

    lines.push(`→ ${formatGroupedHeader(g)}`);

    for (const row of list) {
      const leftText = getGroupedLeftText(row);
      const labelCol = padRight(leftText, leftCol);
      const suffix = formatResetsIn(row.resetTimeIso);

      if (isValueEntry(row)) {
        lines.push(`  ${labelCol} ${row.value}${suffix}`);
        continue;
      }

      const pct = clampInt(row.percentRemaining, 0, 100);
      lines.push(`  ${labelCol} ${bar(pct, barWidth)}  ${pct}% left${suffix}`);
    }
  }

  // Add session token summary (if data available and non-empty)
  const tokenLines = renderSessionTokensLines(params.sessionTokens);
  if (tokenLines.length > 0) {
    lines.push("");
    lines.push(...tokenLines);
  }

  if (params.errors.length > 0) {
    lines.push("");
    for (const err of params.errors) {
      lines.push(`${err.label}: ${err.message}`);
    }
  }

  return lines.join("\n");
}
