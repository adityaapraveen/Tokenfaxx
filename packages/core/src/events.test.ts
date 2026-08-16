import { describe, expect, it } from "vitest";
import { parseEvent } from "./events.js";

describe("event validation", () => {
  it("rejects malformed usage rather than coercing it", () => {
    expect(() =>
      parseEvent({
        id: crypto.randomUUID(),
        schemaVersion: 1,
        sessionId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        agent: "codex",
        repository: "/tmp/repo",
        eventType: "model.usage",
        payload: {
          provider: "openai",
          model: null,
          inputTokens: -1,
          outputTokens: null,
          measurement: "reported",
        },
        metadata: {},
      }),
    ).toThrow();
  });
});
