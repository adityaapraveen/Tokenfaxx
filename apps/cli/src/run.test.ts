import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "@tokenfaxx/core";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";
import { runTracked } from "./index.js";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { recursive: true, force: true }),
    ),
);

describe("tracked process lifecycle", () => {
  it("records provider-reported usage from Codex JSONL", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-codex-json-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const bin = path.join(repository, "bin");
    fs.mkdirSync(bin);
    const codex = path.join(bin, "codex");
    fs.writeFileSync(
      codex,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nprintf '%s\\n' '{"type":"turn.completed","model":"gpt-test","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":30}}'\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await runTracked({
        agent: "codex-json",
        passthroughArgs: ["test task"],
        repository,
        storageRoot: repository,
        config: defaultConfig(),
      });
      const db = new TokenFaxxDatabase(
        path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
      );
      expect(db.getBundle(result.id)?.usage[0]).toMatchObject({
        provider: "openai",
        model: "gpt-test",
        inputTokens: 120,
        cachedTokens: 20,
        outputTokens: 30,
        totalTokens: 150,
        measurementType: "reported",
      });
      db.close();
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("finalizes a session when interrupted", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-interrupt-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const timer = setTimeout(() => process.emit("SIGINT"), 500);
    const result = await runTracked({
      command: 'node -e "setInterval(()=>{},10000)"',
      repository,
      storageRoot: repository,
      config: defaultConfig(),
    });
    clearTimeout(timer);
    expect(result.exitCode).toBe(130);
    const db = new TokenFaxxDatabase(
      path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
    );
    expect(db.getBundle(result.id)?.session.status).toBe("interrupted");
    expect(db.getBundle(result.id)?.outcome?.status).toBe("attempted");
    db.close();
  }, 5_000);
});
