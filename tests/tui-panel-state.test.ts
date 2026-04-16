import { describe, expect, it } from "vitest";

import {
  getSidebarPanelLines,
  shouldRenderSidebarPanel,
  type SidebarPanelState,
} from "../src/lib/tui-panel-state.js";

describe("tui panel state helpers", () => {
  it("shows a loading placeholder before the first sidebar load resolves", () => {
    const panel: SidebarPanelState = {
      status: "loading",
      lines: [],
    };

    expect(shouldRenderSidebarPanel(panel)).toBe(true);
    expect(getSidebarPanelLines(panel)).toEqual(["Loading…"]);
  });

  it("shows an unavailable placeholder after a ready load with no rows", () => {
    const panel: SidebarPanelState = {
      status: "ready",
      lines: [],
    };

    expect(shouldRenderSidebarPanel(panel)).toBe(true);
    expect(getSidebarPanelLines(panel)).toEqual(["Unavailable"]);
  });

  it("hides the sidebar panel completely when quota is disabled", () => {
    const panel: SidebarPanelState = {
      status: "disabled",
      lines: [],
    };

    expect(shouldRenderSidebarPanel(panel)).toBe(false);
    expect(getSidebarPanelLines(panel)).toEqual([]);
  });
});
