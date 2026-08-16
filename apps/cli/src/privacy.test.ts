import { describe, expect, it } from "vitest";
import type { SessionBundle } from "@tokenfaxx/storage";
import { sanitizedEvidenceBundle } from "./index.js";

describe("OpenRouter report privacy", () => {
  it("excludes free-form and sensitive fields from outbound evidence", () => {
    const bundle = {
      session: {
        id: "session-1",
        agent: "codex",
        taskId: "TASK-1",
        taskDescription: "private task text",
        status: "completed",
        durationMs: 100,
        childProcessExitCode: 0,
      },
      events: [
        {
          id: "event-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          eventType: "error",
          payload: {
            command: "deploy --token secret-value",
            message: "private error at /private/path",
            reason: "private reason",
            evidence: ["private evidence"],
            status: "failed",
          },
        },
      ],
      validations: [
        {
          id: "validation-1",
          validationType: "test",
          status: "passed",
          durationMs: 10,
          detailsJson: JSON.stringify({
            parser: "vitest",
            testsPassed: 2,
            limitations: ["private/path/result.json"],
          }),
        },
      ],
      score: null,
    } as unknown as SessionBundle;

    const serialized = JSON.stringify(sanitizedEvidenceBundle(bundle));
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("private task text");
    expect(serialized).not.toContain("private error");
    expect(serialized).not.toContain("private reason");
    expect(serialized).not.toContain("private evidence");
    expect(serialized).not.toContain("private/path/result.json");
    expect(serialized).toContain('"testsPassed":2');
    expect(serialized).toContain('"status":"passed"');
  });
});
