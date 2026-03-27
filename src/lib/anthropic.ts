/**
 * Anthropic Claude quota probing.
 *
 * Uses the local Claude CLI/runtime to detect install/auth state and surface
 * quota windows only when the official runtime exposes them locally. This
 * module does not read Claude consumer OAuth tokens or call Anthropic's OAuth
 * usage endpoint directly.
 */

import { execFile } from "child_process";

import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";

const DEFAULT_CLAUDE_BINARY = "claude";
const CLAUDE_COMMAND_TIMEOUT_MS = 3_000;
const ANTHROPIC_DIAGNOSTICS_TTL_MS = 5_000;

export interface AnthropicQuotaWindow {
  utilization?: number;
  used_percentage?: number;
  usedPercentage?: number;
  used_percent?: number;
  usedPercent?: number;
  percent_used?: number;
  percentUsed?: number;
  resets_at?: string;
  resetsAt?: string;
  reset_at?: string;
  resetAt?: string;
}

export interface AnthropicUsageResponse {
  five_hour: AnthropicQuotaWindow;
  seven_day: AnthropicQuotaWindow;
}

export interface AnthropicQuotaResult {
  success: true;
  five_hour: { percentRemaining: number; resetTimeIso?: string };
  seven_day: { percentRemaining: number; resetTimeIso?: string };
}

export interface AnthropicQuotaError {
  success: false;
  error: string;
}

export type AnthropicResult = AnthropicQuotaResult | AnthropicQuotaError | null;
export type AnthropicAuthStatus = "authenticated" | "unauthenticated" | "unknown";
export type AnthropicQuotaSource = "claude-auth-status-json" | "none";

export interface AnthropicDiagnostics {
  installed: boolean;
  version: string | null;
  authStatus: AnthropicAuthStatus;
  quotaSupported: boolean;
  quotaSource: AnthropicQuotaSource;
  checkedCommands: string[];
  message?: string;
  quota?: AnthropicQuotaResult;
}

export interface AnthropicProbeOptions {
  binaryPath?: string;
}

type ClaudeCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnErrorCode?: number | string;
  errorMessage?: string;
};

export type ClaudeCommandInvocation = {
  file: string;
  args: string[];
  display: string;
};

type AnthropicDiagnosticsCacheEntry = {
  timestamp: number;
  value: AnthropicDiagnostics | null;
  inFlight?: Promise<AnthropicDiagnostics>;
};

type ParsedAuthProbe = {
  authStatus: AnthropicAuthStatus;
  message?: string;
  jsonPayload?: unknown;
  unsupportedCommand?: boolean;
};

const diagnosticsCache = new Map<string, AnthropicDiagnosticsCacheEntry>();

export function resolveAnthropicBinaryPath(binaryPath?: string): string {
  const trimmed = binaryPath?.trim();
  return trimmed ? trimmed : DEFAULT_CLAUDE_BINARY;
}

function formatCommandDisplayArg(value: string): string {
  const sanitized = sanitizeDisplayText(value);
  return /[\s"]/u.test(sanitized) ? JSON.stringify(sanitized) : sanitized;
}

function formatCommandDisplay(parts: string[]): string {
  return parts.map(formatCommandDisplayArg).join(" ");
}

function quoteWindowsCmdArg(value: string): string {
  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

export function buildClaudeCommandInvocation(
  binaryPath: string,
  args: string[],
  runtime: { platform?: NodeJS.Platform; comspec?: string } = {},
): ClaudeCommandInvocation {
  const resolvedBinaryPath = resolveAnthropicBinaryPath(binaryPath);
  const display = formatCommandDisplay([resolvedBinaryPath, ...args]);

  if ((runtime.platform ?? process.platform) === "win32") {
    return {
      file: runtime.comspec?.trim() || process.env["ComSpec"]?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", [resolvedBinaryPath, ...args].map(quoteWindowsCmdArg).join(" ")],
      display,
    };
  }

  return {
    file: resolvedBinaryPath,
    args: [...args],
    display,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeResetTimeIso(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function normalizeUsagePercent(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getWindowUsedPercent(window: Record<string, unknown>): number | undefined {
  const candidates = [
    window["utilization"],
    window["used_percentage"],
    window["usedPercentage"],
    window["used_percent"],
    window["usedPercent"],
    window["percent_used"],
    window["percentUsed"],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUsagePercent(candidate);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

function getWindowResetTimeIso(window: Record<string, unknown>): string | undefined {
  return normalizeResetTimeIso(
    window["resets_at"] ?? window["resetsAt"] ?? window["reset_at"] ?? window["resetAt"],
  );
}

function parseQuotaWindow(window: unknown): { percentRemaining: number; resetTimeIso?: string } | null {
  const record = asRecord(window);
  if (!record) {
    return null;
  }

  const used = getWindowUsedPercent(record);
  if (used === undefined) {
    return null;
  }

  return {
    percentRemaining: Math.max(0, Math.min(100, Math.round(100 - used))),
    resetTimeIso: getWindowResetTimeIso(record),
  };
}

function getUsageRoots(data: unknown): Record<string, unknown>[] {
  const root = asRecord(data);
  if (!root) {
    return [];
  }

  const candidates = [
    root,
    asRecord(root["quota"]),
    asRecord(root["usage"]),
    asRecord(root["rate_limits"]),
    asRecord(root["rateLimits"]),
    asRecord(root["oauth_usage"]),
    asRecord(root["oauthUsage"]),
  ];

  const seen = new Set<Record<string, unknown>>();
  const roots: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    roots.push(candidate);
  }

  return roots;
}

function parseUsageResponse(data: unknown): AnthropicQuotaResult | null {
  for (const root of getUsageRoots(data)) {
    const fiveHour = parseQuotaWindow(root["five_hour"] ?? root["fiveHour"]);
    const sevenDay = parseQuotaWindow(root["seven_day"] ?? root["sevenDay"]);

    if (!fiveHour || !sevenDay) {
      continue;
    }

    return {
      success: true,
      five_hour: fiveHour,
      seven_day: sevenDay,
    };
  }

  return null;
}

function extractAuthBoolean(data: unknown): boolean | undefined {
  const record = asRecord(data);
  if (!record) {
    return undefined;
  }

  for (const candidate of [
    record["authenticated"],
    record["isAuthenticated"],
    record["loggedIn"],
  ]) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  const authRecord = asRecord(record["auth"]);
  if (authRecord) {
    for (const candidate of [authRecord["authenticated"], authRecord["loggedIn"]]) {
      if (typeof candidate === "boolean") {
        return candidate;
      }
    }
  }

  const status = record["status"];
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (normalized === "authenticated") {
      return true;
    }
    if (normalized === "unauthenticated") {
      return false;
    }
  }

  return undefined;
}

function hasUnsupportedCommandText(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("unknown command") ||
    normalized.includes("unrecognized command") ||
    normalized.includes("unexpected argument")
  );
}

function hasUnauthenticatedText(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("not logged in") ||
    normalized.includes("login required") ||
    normalized.includes("authentication required") ||
    normalized.includes("run `claude login`") ||
    normalized.includes("run `claude auth login`") ||
    normalized.includes("run claude login") ||
    normalized.includes("run claude auth login")
  );
}

function detailFromCommandResult(result: ClaudeCommandResult): string | undefined {
  const detail = `${result.stderr}\n${result.stdout}\n${result.errorMessage ?? ""}`.trim();
  return detail ? sanitizeDisplaySnippet(detail, 160) : undefined;
}

function parseVersion(output: string): string | null {
  const match = output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match ? match[0] : null;
}

function isCommandMissing(result: ClaudeCommandResult): boolean {
  if (result.spawnErrorCode === "ENOENT") {
    return true;
  }

  const output = `${result.stderr}\n${result.stdout}\n${result.errorMessage ?? ""}`.toLowerCase();
  return (
    output.includes("command not found") ||
    output.includes("not recognized as an internal or external command") ||
    output.includes("no such file or directory")
  );
}

function isTimedOutError(error: Error & { code?: number | string; killed?: boolean }): boolean {
  return (
    error.code === "ETIMEDOUT" ||
    error.killed === true ||
    error.message.toLowerCase().includes("timed out")
  );
}

async function runClaudeCommand(invocation: ClaudeCommandInvocation): Promise<ClaudeCommandResult> {
  return await new Promise<ClaudeCommandResult>((resolve, reject) => {
    try {
      execFile(
        invocation.file,
        invocation.args,
        {
          encoding: "utf8",
          timeout: CLAUDE_COMMAND_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          const stdoutText = typeof stdout === "string" ? stdout : stdout.toString("utf8");
          const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");

          if (!error) {
            resolve({
              code: 0,
              stdout: stdoutText,
              stderr: stderrText,
              timedOut: false,
            });
            return;
          }

          const execError = error as Error & { code?: number | string; killed?: boolean };
          resolve({
            code: typeof execError.code === "number" ? execError.code : null,
            stdout: stdoutText,
            stderr: stderrText,
            timedOut: isTimedOutError(execError),
            spawnErrorCode: execError.code,
            errorMessage: execError.message,
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

function parseClaudeAuthStatusResult(result: ClaudeCommandResult): ParsedAuthProbe {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  if (hasUnsupportedCommandText(combinedOutput)) {
    return {
      authStatus: "unknown",
      unsupportedCommand: true,
      message:
        "Claude CLI authentication status JSON is unavailable in this version of Claude.",
    };
  }

  if (hasUnauthenticatedText(combinedOutput)) {
    return {
      authStatus: "unauthenticated",
      message: "Claude is not authenticated. Run `claude auth login` and try again.",
    };
  }

  const trimmed = result.stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const payload = JSON.parse(trimmed) as unknown;
      const auth = extractAuthBoolean(payload);

      if (auth === true) {
        return {
          authStatus: "authenticated",
          jsonPayload: payload,
        };
      }

      if (auth === false) {
        return {
          authStatus: "unauthenticated",
          message: "Claude is not authenticated. Run `claude auth login` and try again.",
          jsonPayload: payload,
        };
      }

      return {
        authStatus: "unknown",
        message: "Could not verify Claude authentication status from JSON output.",
        jsonPayload: payload,
      };
    } catch {
      // Fall through to exit-code-based handling.
    }
  }

  if (result.code === 0) {
    return { authStatus: "authenticated" };
  }

  if (result.timedOut) {
    return {
      authStatus: "unknown",
      message: "Timed out while running Claude CLI auth status.",
    };
  }

  const detail = detailFromCommandResult(result);
  return {
    authStatus: "unknown",
    message: detail
      ? `Could not verify Claude authentication status. ${detail}`
      : "Could not verify Claude authentication status.",
  };
}

async function probeAnthropicDiagnostics(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicDiagnostics> {
  const binaryPath = resolveAnthropicBinaryPath(options.binaryPath);
  const checkedCommands: string[] = [];

  const versionCommand = buildClaudeCommandInvocation(binaryPath, ["--version"]);
  checkedCommands.push(versionCommand.display);
  const versionResult = await runClaudeCommand(versionCommand);
  if (isCommandMissing(versionResult)) {
    return {
      installed: false,
      version: null,
      authStatus: "unknown",
      quotaSupported: false,
      quotaSource: "none",
      checkedCommands,
      message: `Claude CLI (\`${sanitizeDisplayText(binaryPath)}\`) is not installed or not on PATH.`,
    };
  }

  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);

  const authStatusJsonCommand = buildClaudeCommandInvocation(binaryPath, [
    "auth",
    "status",
    "--json",
  ]);
  checkedCommands.push(authStatusJsonCommand.display);
  const authJsonResult = await runClaudeCommand(authStatusJsonCommand);
  let parsedAuth = parseClaudeAuthStatusResult(authJsonResult);

  if (parsedAuth.unsupportedCommand) {
    const authStatusCommand = buildClaudeCommandInvocation(binaryPath, ["auth", "status"]);
    checkedCommands.push(authStatusCommand.display);
    parsedAuth = parseClaudeAuthStatusResult(await runClaudeCommand(authStatusCommand));
  }

  if (parsedAuth.authStatus !== "authenticated") {
    return {
      installed: true,
      version,
      authStatus: parsedAuth.authStatus,
      quotaSupported: false,
      quotaSource: "none",
      checkedCommands,
      message: parsedAuth.message,
    };
  }

  const quota = parsedAuth.jsonPayload ? parseUsageResponse(parsedAuth.jsonPayload) : null;
  if (quota) {
    return {
      installed: true,
      version,
      authStatus: "authenticated",
      quotaSupported: true,
      quotaSource: "claude-auth-status-json",
      checkedCommands,
      quota,
    };
  }

  return {
    installed: true,
    version,
    authStatus: "authenticated",
    quotaSupported: false,
    quotaSource: "none",
    checkedCommands,
    message: "Claude CLI auth detected, but local quota windows were not exposed.",
  };
}

export function clearAnthropicDiagnosticsCacheForTests(): void {
  diagnosticsCache.clear();
}

export async function getAnthropicDiagnostics(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicDiagnostics> {
  const binaryPath = resolveAnthropicBinaryPath(options.binaryPath);
  const now = Date.now();
  const cached = diagnosticsCache.get(binaryPath) ?? {
    timestamp: 0,
    value: null,
  };

  if (
    cached.value &&
    cached.timestamp > 0 &&
    now - cached.timestamp < ANTHROPIC_DIAGNOSTICS_TTL_MS
  ) {
    return cached.value;
  }

  if (cached.inFlight) {
    return cached.inFlight;
  }

  const inFlight = probeAnthropicDiagnostics({ binaryPath }).then((value) => {
    diagnosticsCache.set(binaryPath, {
      timestamp: Date.now(),
      value,
    });
    return value;
  });

  diagnosticsCache.set(binaryPath, {
    timestamp: cached.timestamp,
    value: cached.value,
    inFlight,
  });

  try {
    return await inFlight;
  } finally {
    const latest = diagnosticsCache.get(binaryPath);
    if (latest?.inFlight === inFlight) {
      diagnosticsCache.set(binaryPath, {
        timestamp: latest.timestamp,
        value: latest.value,
      });
    }
  }
}

export async function hasAnthropicCredentialsConfigured(
  options: AnthropicProbeOptions = {},
): Promise<boolean> {
  try {
    const diagnostics = await getAnthropicDiagnostics(options);
    return diagnostics.installed && diagnostics.authStatus === "authenticated";
  } catch {
    return false;
  }
}

export async function queryAnthropicQuota(
  options: AnthropicProbeOptions = {},
): Promise<AnthropicResult> {
  try {
    const diagnostics = await getAnthropicDiagnostics(options);
    return diagnostics.quotaSupported ? diagnostics.quota ?? null : null;
  } catch (err) {
    return {
      success: false,
      error: `Claude CLI probe failed: ${sanitizeDisplayText(
        err instanceof Error ? err.message : String(err),
      )}`,
    };
  }
}

export { parseUsageResponse };
