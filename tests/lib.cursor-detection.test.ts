import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFiles = vi.hoisted(() => new Map<string, string>());

vi.mock("fs", () => ({
  existsSync: vi.fn((path: string) => mockFiles.has(path)),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(async (path: string) => {
    if (!mockFiles.has(path)) {
      throw new Error(`missing: ${path}`);
    }
    return mockFiles.get(path)!;
  }),
}));

vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: () => "/tmp/home",
    platform: () => "linux",
  };
});

vi.mock("../src/lib/opencode-auth.js", () => ({
  getAuthPaths: () => ["/tmp/auth.json"],
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: () => ({
    dataDirs: ["/tmp/data"],
    configDirs: ["/tmp/config"],
    cacheDirs: ["/tmp/cache"],
    stateDirs: ["/tmp/state"],
  }),
}));

describe("cursor detection", () => {
  beforeEach(() => {
    mockFiles.clear();
    vi.resetModules();
    delete process.env.CURSOR_ACP_HOME_DIR;
  });

  it("prefers Cursor OAuth auth in OpenCode auth.json", async () => {
    mockFiles.set(
      "/tmp/auth.json",
      JSON.stringify({
        cursor: {
          type: "oauth",
          refresh: "refresh-token",
        },
      }),
    );
    mockFiles.set("/tmp/home/.config/cursor/auth.json", JSON.stringify({ accessToken: "legacy-token" }));

    const { inspectCursorAuthPresence } = await import("../src/lib/cursor-detection.js");
    const result = await inspectCursorAuthPresence();

    expect(result.state).toBe("present");
    expect(result.selectedPath).toBe("/tmp/auth.json");
    expect(result.presentPaths).toContain("/tmp/auth.json");
    expect(result.presentPaths).toContain("/tmp/home/.config/cursor/auth.json");
  });

  it("detects the OAuth plugin package and provider.cursor config", async () => {
    mockFiles.set(
      "/tmp/config/opencode.json",
      JSON.stringify({
        plugin: ["opencode-cursor-oauth"],
        provider: {
          cursor: {
            name: "Cursor",
          },
        },
      }),
    );

    const { inspectCursorOpenCodeIntegration } = await import("../src/lib/cursor-detection.js");
    const result = await inspectCursorOpenCodeIntegration();

    expect(result.pluginEnabled).toBe(true);
    expect(result.providerConfigured).toBe(true);
    expect(result.matchedPaths).toEqual(["/tmp/config/opencode.json"]);
  });

  it("detects legacy cursor runtime ids in provider config without treating them as plugins", async () => {
    mockFiles.set(
      "/tmp/config/opencode.json",
      JSON.stringify({
        plugin: ["some-other-plugin"],
        provider: {
          "cursor-acp": {
            name: "Cursor ACP",
          },
        },
      }),
    );

    const { inspectCursorOpenCodeIntegration } = await import("../src/lib/cursor-detection.js");
    const result = await inspectCursorOpenCodeIntegration();

    expect(result.pluginEnabled).toBe(false);
    expect(result.providerConfigured).toBe(true);
    expect(result.matchedPaths).toEqual(["/tmp/config/opencode.json"]);
  });
});
