import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "os";
import { join } from "path";

const mocks = vi.hoisted(() => ({
  getAuthPaths: vi.fn(() => ["/tmp/auth.json", "/tmp/auth-fallback.json"]),
  readAuthFileCached: vi.fn(),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: () => ({
    dataDirs: [join(homedir(), ".local", "share", "opencode")],
    configDirs: [join(homedir(), ".config", "opencode")],
    cacheDirs: [join(homedir(), ".cache", "opencode")],
    stateDirs: [join(homedir(), ".local", "state", "opencode")],
  }),
  getOpencodeRuntimeDirs: () => ({
    dataDir: join(homedir(), ".local", "share", "opencode"),
    configDir: join(homedir(), ".config", "opencode"),
    cacheDir: join(homedir(), ".cache", "opencode"),
    stateDir: join(homedir(), ".local", "state", "opencode"),
  }),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  getAuthPaths: mocks.getAuthPaths,
  readAuthFileCached: mocks.readAuthFileCached,
}));

import {
  DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS,
  getAlibabaCodingPlanAuthDiagnostics,
  getOpencodeConfigCandidatePaths,
  hasAlibabaAuth,
  resolveAlibabaCodingPlanAuth,
  resolveAlibabaCodingPlanAuthCached,
} from "../src/lib/alibaba-auth.js";

describe("alibaba auth resolution", () => {
  const originalEnv = process.env;
  const trustedJsonPath = join(homedir(), ".config", "opencode", "opencode.json");
  const trustedJsoncPath = join(homedir(), ".config", "opencode", "opencode.jsonc");

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ALIBABA_CODING_PLAN_API_KEY;
    delete process.env.ALIBABA_API_KEY;

    mocks.getAuthPaths.mockReset().mockReturnValue(["/tmp/auth.json", "/tmp/auth-fallback.json"]);
    mocks.readAuthFileCached.mockReset();

    const { existsSync } = await import("fs");
    const { readFile } = await import("fs/promises");
    (existsSync as any).mockReset().mockReturnValue(false);
    (readFile as any).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveAlibabaCodingPlanAuth", () => {
    it.each([
      ["auth is null", null],
      ["auth is undefined", undefined],
      ["alibaba entries are missing", {}],
    ])("returns none when %s", (_label, auth) => {
      expect(resolveAlibabaCodingPlanAuth(auth as any)).toEqual({ state: "none" });
      expect(hasAlibabaAuth(auth as any)).toBe(false);
    });

    it("falls back from alibaba-coding-plan to alibaba when the first alias has no usable credential", () => {
      const auth = {
        "alibaba-coding-plan": { type: "api", key: "   " },
        alibaba: { type: "api", access: " dashscope-key ", tier: "pro" },
      };

      expect(resolveAlibabaCodingPlanAuth(auth as any)).toEqual({
        state: "configured",
        apiKey: "dashscope-key",
        tier: "pro",
      });
      expect(hasAlibabaAuth(auth as any)).toBe(true);
    });

    it("uses the configured fallback tier when auth omits tier", () => {
      expect(
        resolveAlibabaCodingPlanAuth(
          {
            "alibaba-coding-plan": { type: "api", key: "dashscope-key" },
          } as any,
          "pro",
        ),
      ).toEqual({
        state: "configured",
        apiKey: "dashscope-key",
        tier: "pro",
      });
    });

    it("preserves type-agnostic credential resolution for existing auth.json entries", () => {
      expect(
        resolveAlibabaCodingPlanAuth({
          alibaba: { type: "oauth", key: "dashscope-key", tier: "lite" },
        } as any),
      ).toEqual({
        state: "configured",
        apiKey: "dashscope-key",
        tier: "lite",
      });
    });

    it("returns invalid for unsupported tiers", () => {
      expect(
        resolveAlibabaCodingPlanAuth({
          alibaba: { type: "api", key: "dashscope-key", tier: "max" },
        } as any),
      ).toEqual({
        state: "invalid",
        error: "Unsupported Alibaba Coding Plan tier: max",
        rawTier: "max",
      });
    });
  });

  describe("resolveAlibabaCodingPlanAuthCached", () => {
    it("prefers ALIBABA_CODING_PLAN_API_KEY over auth.json and uses the fallback tier", async () => {
      process.env.ALIBABA_CODING_PLAN_API_KEY = "env-key";
      mocks.readAuthFileCached.mockResolvedValueOnce({
        alibaba: { type: "api", key: "auth-key", tier: "max" },
      });

      await expect(resolveAlibabaCodingPlanAuthCached({ fallbackTier: "pro" })).resolves.toEqual({
        state: "configured",
        apiKey: "env-key",
        tier: "pro",
      });
      expect(mocks.readAuthFileCached).not.toHaveBeenCalled();
    });

    it("reads from trusted global config aliases", async () => {
      const { existsSync } = await import("fs");
      const { readFile } = await import("fs/promises");

      (existsSync as any).mockImplementation((path: string) => path === trustedJsonPath);
      (readFile as any).mockResolvedValue(
        JSON.stringify({
          provider: {
            alibaba: {
              options: {
                apiKey: "json-key",
              },
            },
          },
        }),
      );

      await expect(resolveAlibabaCodingPlanAuthCached({ fallbackTier: "lite" })).resolves.toEqual({
        state: "configured",
        apiKey: "json-key",
        tier: "lite",
      });
      expect(mocks.readAuthFileCached).not.toHaveBeenCalled();
    });

    it("resolves allowlisted env templates from trusted config", async () => {
      process.env.ALIBABA_API_KEY = "templated-key";

      const { existsSync } = await import("fs");
      const { readFile } = await import("fs/promises");

      (existsSync as any).mockImplementation((path: string) => path === trustedJsoncPath);
      (readFile as any).mockResolvedValue(`{
        "provider": {
          "alibaba-coding-plan": {
            "options": {
              "apiKey": "{env:ALIBABA_API_KEY}"
            }
          }
        }
      }`);

      await expect(resolveAlibabaCodingPlanAuthCached()).resolves.toEqual({
        state: "configured",
        apiKey: "templated-key",
        tier: "lite",
      });
    });

    it("ignores workspace-local opencode.json when resolving provider secrets", async () => {
      const { existsSync } = await import("fs");
      const workspacePath = join(process.cwd(), "opencode.json");

      (existsSync as any).mockImplementation((path: string) => path === workspacePath);
      mocks.readAuthFileCached.mockResolvedValueOnce(null);

      await expect(resolveAlibabaCodingPlanAuthCached()).resolves.toEqual({ state: "none" });
    });

    it("falls back to auth.json when env/config are not configured", async () => {
      mocks.readAuthFileCached.mockResolvedValueOnce({
        alibaba: { type: "api", access: "dashscope-key", tier: "pro" },
      });

      await expect(resolveAlibabaCodingPlanAuthCached()).resolves.toEqual({
        state: "configured",
        apiKey: "dashscope-key",
        tier: "pro",
      });
      expect(mocks.readAuthFileCached).toHaveBeenCalledWith({
        maxAgeMs: DEFAULT_ALIBABA_AUTH_CACHE_MAX_AGE_MS,
      });
    });

    it("surfaces invalid auth.json tiers only when fallback auth wins", async () => {
      mocks.readAuthFileCached.mockResolvedValueOnce({
        alibaba: { type: "api", key: "dashscope-key", tier: "max" },
      });

      await expect(resolveAlibabaCodingPlanAuthCached()).resolves.toEqual({
        state: "invalid",
        error: "Unsupported Alibaba Coding Plan tier: max",
        rawTier: "max",
      });
    });

    it("clamps negative maxAgeMs to 0", async () => {
      mocks.readAuthFileCached.mockResolvedValueOnce({});

      await resolveAlibabaCodingPlanAuthCached({ maxAgeMs: -100 });
      expect(mocks.readAuthFileCached).toHaveBeenCalledWith({ maxAgeMs: 0 });
    });
  });

  describe("getAlibabaCodingPlanAuthDiagnostics", () => {
    it("reports env-based configuration with auth candidate paths", async () => {
      process.env.ALIBABA_API_KEY = "diag-key";

      await expect(getAlibabaCodingPlanAuthDiagnostics()).resolves.toEqual({
        state: "configured",
        source: "env:ALIBABA_API_KEY",
        checkedPaths: ["env:ALIBABA_API_KEY"],
        authPaths: ["/tmp/auth.json", "/tmp/auth-fallback.json"],
        tier: "lite",
      });
    });

    it("reports checked trusted config paths separately from auth paths", async () => {
      const { existsSync } = await import("fs");
      const { readFile } = await import("fs/promises");

      (existsSync as any).mockImplementation((path: string) => path === trustedJsonPath);
      (readFile as any).mockResolvedValue("{}");
      mocks.readAuthFileCached.mockResolvedValueOnce(null);

      await expect(getAlibabaCodingPlanAuthDiagnostics()).resolves.toEqual({
        state: "none",
        source: null,
        checkedPaths: [trustedJsonPath],
        authPaths: ["/tmp/auth.json", "/tmp/auth-fallback.json"],
      });
    });

    it("reports invalid auth.json diagnostics when fallback auth is malformed", async () => {
      mocks.readAuthFileCached.mockResolvedValueOnce({
        alibaba: { type: "api", key: "dashscope-key", tier: "max" },
      });

      await expect(getAlibabaCodingPlanAuthDiagnostics()).resolves.toEqual({
        state: "invalid",
        source: "auth.json",
        checkedPaths: [],
        authPaths: ["/tmp/auth.json", "/tmp/auth-fallback.json"],
        error: "Unsupported Alibaba Coding Plan tier: max",
        rawTier: "max",
      });
    });
  });

  describe("getOpencodeConfigCandidatePaths", () => {
    it("returns trusted global paths only", () => {
      const paths = getOpencodeConfigCandidatePaths();

      expect(paths).toHaveLength(2);
      expect(paths[0]).toEqual({ path: trustedJsoncPath, isJsonc: true });
      expect(paths[1]).toEqual({ path: trustedJsonPath, isJsonc: false });
    });
  });
});
