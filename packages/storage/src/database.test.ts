import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TokenFaxxDatabase } from "./database.js";
const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
);
describe("storage", () => {
  it("initializes and cascades session deletion", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenfaxx-"));
    dirs.push(dir);
    const db = new TokenFaxxDatabase(path.join(dir, "db.sqlite"));
    expect(
      (
        db.sqlite
          .prepare("SELECT MAX(version) AS version FROM _migrations")
          .get() as { version: number }
      ).version,
    ).toBe(2);
    const session = db.createSession({
      repository: dir,
      projectName: "test",
      agent: "custom",
      adapterVersion: "1",
    });
    expect(db.listSessions()).toHaveLength(1);
    expect(db.deleteSession(session.id)).toBe(true);
    expect(db.listSessions()).toHaveLength(0);
    db.close();
  });
  it("stores analysis separately from coding-agent usage", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenfaxx-"));
    dirs.push(dir);
    const db = new TokenFaxxDatabase(path.join(dir, "db.sqlite"));
    const session = db.createSession({
      repository: dir,
      projectName: "test",
      agent: "custom",
      adapterVersion: "1",
    });
    db.appendEvent({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      agent: "custom",
      repository: dir,
      eventType: "analysis.completed",
      payload: {
        provider: "openrouter",
        model: "test/model",
        generationId: "gen-1",
        evidenceHash: "a".repeat(64),
        schemaVersion: 1,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUsd: 0.001,
        },
        analysis: { summary: "facts" },
      },
      metadata: {},
    });
    expect(db.getBundle(session.id)?.analyses).toHaveLength(1);
    expect(db.getBundle(session.id)?.usage).toHaveLength(0);
    db.close();
  });
});
