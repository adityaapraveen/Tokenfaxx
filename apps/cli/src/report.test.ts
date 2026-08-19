import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";
import { asCsv, renderReport, reportObject } from "./report.js";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { recursive: true, force: true }),
    ),
);

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

  it("exposes a stored benchmark verdict in JSON and terminal reports", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-report-benchmark-"),
    );
    directories.push(directory);
    const db = new TokenFaxxDatabase(path.join(directory, "tokenfaxx.db"));
    const session = db.createSession({
      repository: directory,
      projectName: "benchmark-report",
      agent: "custom",
      adapterVersion: "1",
    });
    db.appendEvent({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      agent: session.agent,
      repository: directory,
      eventType: "benchmark.evaluated",
      payload: {
        benchmarkId: "migration",
        definitionHashVersion: 1,
        definitionHash: "a".repeat(64),
        resolvedStartingCommit: "abc123",
        passed: false,
        checks: [
          {
            expectation: "testsPass",
            validationType: "test",
            expected: true,
            actual: null,
            validationStatus: null,
            status: "missing",
          },
        ],
      },
      metadata: {},
    });

    const bundle = db.getBundle(session.id)!;
    expect(reportObject(bundle).benchmark).toEqual(
      expect.objectContaining({ benchmarkId: "migration", passed: false }),
    );
    expect(renderReport(bundle)).toContain(
      "test: expected pass, observed missing — missing",
    );
    db.close();
  });
});
