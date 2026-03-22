/**
 * Shared display sanitization for user-visible output.
 *
 * Strips ANSI escape sequences and other control characters so that
 * remote/provider error text cannot inject terminal control codes into
 * toasts or transcript output.
 */

// Remove ANSI escape sequences and other control characters except newline/tab.
// eslint-disable-next-line no-control-regex
const DISPLAY_CONTROL_RE = /\x1B\[[0-9;]*[A-Za-z]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeDisplayText(text: string): string {
  return text.replace(DISPLAY_CONTROL_RE, "");
}

export function sanitizeDisplaySnippet(text: string, maxLength: number): string {
  return sanitizeDisplayText(text).slice(0, maxLength);
}
