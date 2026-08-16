import { describe, expect, it } from "vitest";
import { asCsv } from "./report.js";

describe("report exports", () => {
  it("preserves unavailable values as empty CSV fields", () => {
    const csv = asCsv([
      {
        session: { id: "s1", agent: "codex", taskId: null },
        process: { status: { value: "completed" }, durationMs: { value: 10 } },
        task: { outcome: { value: "completed-unverified" }, accepted: null },
        validation: [],
        usage: {
          totalTokens: { value: null },
          estimatedCostUsd: { value: null },
        },
        score: null,
      },
    ]);
    expect(csv).toContain("sessionId,agent,taskId,processStatus,taskOutcome");
    expect(csv).toContain("s1,codex,,completed,completed-unverified");
  });
});
