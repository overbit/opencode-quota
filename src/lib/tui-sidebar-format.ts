import type { QuotaRenderData } from "./quota-render-data.js";
import type { QuotaToastConfig } from "./types.js";

import { sanitizeQuotaRenderData } from "./display-sanitize.js";
import { formatQuotaRows } from "./format.js";

export const TUI_SIDEBAR_MAX_WIDTH = 36;
export const TUI_SIDEBAR_LAYOUT = {
  maxWidth: TUI_SIDEBAR_MAX_WIDTH,
  narrowAt: TUI_SIDEBAR_MAX_WIDTH,
  tinyAt: 20,
} as const;

export function buildSidebarQuotaPanelLines(params: {
  data: QuotaRenderData;
  config: Pick<QuotaToastConfig, "toastStyle">;
}): string[] {
  const data = sanitizeQuotaRenderData(params.data);

  const formatted = formatQuotaRows({
    version: "1.0.0",
    layout: TUI_SIDEBAR_LAYOUT,
    entries: data.entries,
    errors: data.errors,
    style: params.config.toastStyle,
    sessionTokens: data.sessionTokens,
  });

  return formatted ? formatted.split("\n") : [];
}
