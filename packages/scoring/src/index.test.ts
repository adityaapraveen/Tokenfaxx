import { describe, expect, it } from "vitest";
import { defaultConfig } from "@tokenfaxx/core";
import { evaluate } from "./index.js";
describe("scoring", () => {
  it("does not reward a failed task for low token use", () => {
    const failed = evaluate(
      {
        outcome: "failed",
        commitCount: 0,
        filesChanged: 0,
        validations: [{ type: "test", status: "failed" }],
        totalTokens: 1,
      },
      defaultConfig(),
    );
    expect(
      failed.components.find((c) => c.name === "tokenEfficiency")?.normalized,
    ).toBeNull();
  });
  it("returns insufficient data for unknown outcome", () =>
    expect(
      evaluate(
        {
          outcome: "unknown",
          commitCount: 0,
          filesChanged: 0,
          validations: [],
        },
        defaultConfig(),
      ).finalScore,
    ).toBeNull());
  it("withholds efficiency for an unvalidated process success", () => {
    const result = evaluate(
      {
        outcome: "completed-unverified",
        taskId: "T-1",
        commitCount: 1,
        filesChanged: 2,
        validations: [],
        totalTokens: 100,
        taskProfile: {
          taskType: "bugfix",
          validationCount: 0,
          complexity: "small",
          complexitySource: "user",
          tags: [],
        },
      },
      defaultConfig(),
    );
    expect(result.finalScore).toBeNull();
    expect(result.confidences.outcome).toBeLessThan(60);
  });
  it("uses timeline transitions as transparent rework evidence", () => {
    const result = evaluate(
      {
        outcome: "completed-validated",
        commitCount: 1,
        filesChanged: 1,
        validations: [{ type: "test", status: "passed" }],
        timeline: [
          {
            timestamp: "1",
            changedFiles: [
              {
                path: "a.ts",
                index: "M",
                workingTree: "M",
                size: 1,
                modifiedAtMs: 1,
              },
            ],
          },
          {
            timestamp: "2",
            changedFiles: [
              {
                path: "a.ts",
                index: "M",
                workingTree: "M",
                size: 2,
                modifiedAtMs: 2,
              },
            ],
          },
        ],
      },
      defaultConfig(),
    );
    expect(result.reworkRate).not.toBeNull();
    expect(result.reworkEvidence.join(" ")).toContain(
      "multiple observed intervals",
    );
  });
});
