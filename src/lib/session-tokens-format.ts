/**
 * Shared "Session Tokens" rendering block.
 *
 * Extracted from format.ts, toast-format-grouped.ts, and
 * quota-command-format.ts to eliminate verbatim duplication.
 */

import type { SessionTokensData } from "./entries.js";
import { formatTokenCount, padLeft, padRight, shortenModelName } from "./format-utils.js";

export const WIDE_SESSION_TOKEN_LINE_WIDTH = 45;

function renderWideSessionTokensLines(sessionTokens: SessionTokensData): string[] {
  const lines: string[] = [];
  lines.push("Session Tokens");

  for (const model of sessionTokens.models) {
    const shortName = shortenModelName(model.modelID, 20);
    const inStr = formatTokenCount(model.input);
    const outStr = formatTokenCount(model.output);
    lines.push(`  ${padRight(shortName, 20)}  ${padLeft(inStr, 6)} in  ${padLeft(outStr, 6)} out`);
  }

  return lines;
}

function renderCompactSessionTokensLines(
  sessionTokens: SessionTokensData,
  maxWidth: number,
): string[] {
  const width = Math.max(1, Math.trunc(maxWidth));
  const lines: string[] = [];
  lines.push("Session Tokens".slice(0, width));

  for (const model of sessionTokens.models) {
    const modelIndent = width > 2 ? "  " : "";
    const modelLineWidth = Math.max(1, width - modelIndent.length);
    const detailIndent = width > 4 ? "    " : width > 2 ? "  " : "";
    const inStr = formatTokenCount(model.input);
    const outStr = formatTokenCount(model.output);
    const compactCounts = `${inStr} in  ${outStr} out`;

    lines.push(`${modelIndent}${shortenModelName(model.modelID, modelLineWidth)}`.slice(0, width));

    if (detailIndent.length + compactCounts.length <= width) {
      lines.push(`${detailIndent}${compactCounts}`.slice(0, width));
      continue;
    }

    lines.push(`${detailIndent}${inStr} in`.slice(0, width));
    lines.push(`${detailIndent}${outStr} out`.slice(0, width));
  }

  return lines;
}

/**
 * Render the "Session Tokens" section lines.
 *
 * Returns an empty array when there is no data to display.
 * Callers are responsible for inserting a leading blank line if needed.
 */
export function renderSessionTokensLines(
  sessionTokens?: SessionTokensData,
  options?: { maxWidth?: number },
): string[] {
  if (!sessionTokens || sessionTokens.models.length === 0) return [];
  if (
    typeof options?.maxWidth === "number" &&
    Number.isFinite(options.maxWidth) &&
    options.maxWidth < WIDE_SESSION_TOKEN_LINE_WIDTH
  ) {
    return renderCompactSessionTokensLines(sessionTokens, options.maxWidth);
  }
  return renderWideSessionTokensLines(sessionTokens);
}
