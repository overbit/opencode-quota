export type SidebarPanelState = {
  status: "loading" | "disabled" | "ready";
  lines: string[];
};

export function shouldRenderSidebarPanel(panel: SidebarPanelState): boolean {
  return panel.status !== "disabled";
}

export function getSidebarPanelLines(panel: SidebarPanelState): string[] {
  if (panel.lines.length > 0) return panel.lines;
  if (panel.status === "ready") return ["Unavailable"];
  if (panel.status === "loading") return ["Loading…"];
  return [];
}
