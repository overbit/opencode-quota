import type { QuotaToastEntry } from "./entries.js";

export type GroupedRenderTarget = "toast" | "quota";

export type NormalizedGroupedQuotaEntry = QuotaToastEntry & {
  group: string;
};

function trimOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function looksLikeGoogleModel(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "claude" || lower === "g3pro" || lower === "g3flash" || lower === "g3image";
}

function getGoogleFallbackMeta(name: string): { group: string; label: string } | undefined {
  const match = name.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (!match) return undefined;

  const model = match[1]!.trim();
  const account = match[2]!.trim();
  if (!looksLikeGoogleModel(model) || !account) return undefined;

  return {
    group: `Google Antigravity (${account})`,
    label: `${model}:`,
  };
}

export function normalizeGroupedQuotaEntries(
  entries: QuotaToastEntry[],
  target: GroupedRenderTarget,
): NormalizedGroupedQuotaEntry[] {
  return entries.map((entry) => {
    const group = trimOptional(entry.group);
    const label = trimOptional(entry.label);
    const right = trimOptional(entry.right);
    const normalized = {
      ...entry,
      ...(label ? { label } : {}),
      ...(right ? { right } : {}),
    };

    if (group) {
      return { ...normalized, group };
    }

    if (target === "quota") {
      const googleFallback = getGoogleFallbackMeta(entry.name);
      if (googleFallback) {
        return {
          ...normalized,
          group: googleFallback.group,
          label: label ?? googleFallback.label,
        };
      }
    }

    return {
      ...normalized,
      group: entry.name.trim(),
      ...(target === "quota" ? { label: label ?? "Status:" } : {}),
    };
  });
}
