import { describe, expect, it } from "vitest";
import {
  analyzeWithOpenRouter,
  inferTaskProfileWithOpenRouter,
} from "./index.js";
describe("OpenRouter analysis", () => {
  it("validates structured evidence-bound output", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "gen-1",
          model: "test/model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Observed facts only",
                  strengths: [],
                  concerns: [],
                  anomalies: [],
                  missingEvidence: ["acceptance"],
                  recommendations: [],
                  disclaimer: "Session evidence only",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
            cost: 0.001,
          },
        }),
        { status: 200 },
      );
    const result = await analyzeWithOpenRouter(
      { events: [] },
      {
        apiKey: "secret",
        model: "test/model",
        timeoutMs: 1000,
        maxCostUsd: 0.01,
        fetchImpl,
      },
    );
    expect(result.evidenceHash).toHaveLength(64);
    expect(result.analysis.missingEvidence).toContain("acceptance");
  });

  it("rejects hallucinated anomaly evidence references", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Claim",
                  strengths: [],
                  concerns: [],
                  anomalies: [
                    {
                      observation: "Unsupported",
                      evidenceEventIds: ["session-id"],
                      confidence: 90,
                    },
                  ],
                  missingEvidence: [],
                  recommendations: [],
                  disclaimer: "Evidence only",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    await expect(
      analyzeWithOpenRouter(
        {
          session: { id: "session-id" },
          events: [{ id: "real-event-id" }],
        },
        {
          apiKey: "secret",
          model: "test/model",
          timeoutMs: 1000,
          maxCostUsd: 0.01,
          fetchImpl,
        },
      ),
    ).rejects.toThrow(/unknown evidence ID 'session-id'/);
  });

  it("returns a bounded structured task profile", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "profile-1",
          model: "test/model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  taskType: "bugfix",
                  complexity: "small",
                  confidence: 82,
                  rationale: "One localized behavior is described.",
                  missingEvidence: ["Repository structure"],
                  tags: ["validation"],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 30,
            total_tokens: 50,
            cost: 0.002,
          },
        }),
        { status: 200 },
      );
    const result = await inferTaskProfileWithOpenRouter("Fix parser output", {
      apiKey: "secret",
      model: "test/model",
      timeoutMs: 1000,
      maxCostUsd: 0.01,
      fetchImpl,
    });
    expect(result.profile).toMatchObject({
      taskType: "bugfix",
      complexity: "small",
      confidence: 82,
    });
    expect(result.usage.totalTokens).toBe(50);
  });
});
