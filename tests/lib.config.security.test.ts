import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadConfig } from "../src/lib/config.js";

describe("loadConfig security precedence", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string;
  let workspaceDir: string;
  let xdgConfigHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-quota-config-"));
    workspaceDir = join(tempDir, "workspace");
    xdgConfigHome = join(tempDir, "xdg-config");

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(xdgConfigHome, "opencode"), { recursive: true });

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: join(tempDir, "xdg-data"),
      XDG_CACHE_HOME: join(tempDir, "xdg-cache"),
      XDG_STATE_HOME: join(tempDir, "xdg-state"),
    };
    process.chdir(workspaceDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps user/global network-affecting settings authoritative over workspace config", async () => {
    writeFileSync(
      join(xdgConfigHome, "opencode", "opencode.json"),
      JSON.stringify({
        experimental: {
          quotaToast: {
            enabled: false,
            enabledProviders: ["openai"],
            showOnIdle: false,
            showOnQuestion: false,
            showOnCompact: false,
            minIntervalMs: 600000,
            pricingSnapshot: { source: "bundled", autoRefresh: 30 },
            toastStyle: "classic",
          },
        },
      }),
      "utf-8",
    );

    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        experimental: {
          quotaToast: {
            enabled: true,
            enabledProviders: ["chutes"],
            showOnIdle: true,
            showOnQuestion: true,
            showOnCompact: true,
            minIntervalMs: 1000,
            pricingSnapshot: { source: "runtime", autoRefresh: 1 },
            toastStyle: "grouped",
            onlyCurrentModel: true,
          },
        },
      }),
      "utf-8",
    );

    const cfg = await loadConfig({
      config: {
        get: async () => ({
          data: {
            experimental: {
              quotaToast: {
                enabled: true,
                enabledProviders: ["zai"],
                toastStyle: "grouped",
              },
            },
          },
        }),
      },
    });

    expect(cfg.enabled).toBe(false);
    expect(cfg.enabledProviders).toEqual(["openai"]);
    expect(cfg.showOnIdle).toBe(false);
    expect(cfg.showOnQuestion).toBe(false);
    expect(cfg.showOnCompact).toBe(false);
    expect(cfg.minIntervalMs).toBe(600000);
    expect(cfg.pricingSnapshot).toEqual({ source: "bundled", autoRefresh: 30 });

    expect(cfg.toastStyle).toBe("grouped");
    expect(cfg.onlyCurrentModel).toBe(true);
  });
});
