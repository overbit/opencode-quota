import { describe, expect, it } from "vitest";

import { normalizeGroupedQuotaEntries } from "../src/lib/grouped-entry-normalization.js";

describe("normalizeGroupedQuotaEntries", () => {
  it("keeps the Google fallback specific to /quota rendering", () => {
    const entry = {
      name: "Claude (acct)",
      percentRemaining: 67,
      resetTimeIso: "2026-01-15T15:00:00.000Z",
    } as const;

    expect(normalizeGroupedQuotaEntries([entry], "quota")).toEqual([
      {
        ...entry,
        group: "Google Antigravity (acct)",
        label: "Claude:",
      },
    ]);

    expect(normalizeGroupedQuotaEntries([entry], "toast")).toEqual([
      {
        ...entry,
        group: "Claude (acct)",
      },
    ]);
  });
});
