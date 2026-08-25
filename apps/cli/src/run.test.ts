import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "@tokenfaxx/core";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";
import { program, runTracked, safeChildEnv } from "./index.js";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { recursive: true, force: true }),
    ),
);

describe("tracked process lifecycle", () => {
  it("removes credential-like adapter environment overrides", () => {
    expect(
      safeChildEnv({
        PATH: "/custom/bin",
        PROVIDER_API_TOKEN: "must-not-leak",
        SAFE_SETTING: "visible",
      }),
    ).toMatchObject({ PATH: "/custom/bin", SAFE_SETTING: "visible" });
    expect(
      safeChildEnv({ PROVIDER_API_TOKEN: "must-not-leak" }),
    ).not.toHaveProperty("PROVIDER_API_TOKEN");
  });

  it("forwards the first argument after -- to a structured provider", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-cli-args-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const bin = path.join(repository, "bin");
    fs.mkdirSync(bin);
    const captured = path.join(repository, "codex-args.txt");
    const codex = path.join(bin, "codex");
    fs.writeFileSync(
      codex,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nprintf '%s\\n' "$@" > "$TEST_CAPTURE"\nprintf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'\n`,
      { mode: 0o755 },
    );
    const previousCwd = process.cwd();
    const previousPath = process.env.PATH;
    const previousCapture = process.env.TEST_CAPTURE;
    process.chdir(repository);
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
    process.env.TEST_CAPTURE = captured;
    try {
      await program.parseAsync([
        process.execPath,
        "tokenfaxx",
        "run",
        "--agent",
        "codex-json",
        "--task-id",
        "CLI-ARGS",
        "--",
        "the first prompt",
      ]);
      expect(fs.readFileSync(captured, "utf8").split(/\r?\n/)).toEqual([
        "exec",
        "--json",
        "the first prompt",
        "",
      ]);
    } finally {
      process.chdir(previousCwd);
      process.env.PATH = previousPath;
      if (previousCapture === undefined) delete process.env.TEST_CAPTURE;
      else process.env.TEST_CAPTURE = previousCapture;
    }
  });

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

  it("treats an explicit provider failure as authoritative over exit zero", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-provider-failure-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const bin = path.join(repository, "bin");
    fs.mkdirSync(bin);
    const codex = path.join(bin, "codex");
    fs.writeFileSync(
      codex,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf '%s\\n' '{"type":"turn.failed","error":{"message":"private response"}}'\nexit 0\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await runTracked({
        agent: "codex-json",
        passthroughArgs: ["task"],
        repository,
        storageRoot: repository,
        config: defaultConfig(),
      });
      expect(result.exitCode).toBe(1);
      const db = new TokenFaxxDatabase(
        path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
      );
      const bundle = db.getBundle(result.id);
      expect(bundle?.session).toMatchObject({
        status: "failed",
        childProcessExitCode: 0,
      });
      expect(bundle?.outcome).toMatchObject({
        status: "failed",
        reason: "Codex JSONL turn.failed",
      });
      expect(JSON.stringify(bundle)).not.toContain("private response");
      db.close();
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("does not claim a mutating task completed without Git change evidence", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-no-change-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const result = await runTracked({
      command: 'node -e "process.exit(0)"',
      taskType: "feature",
      repository,
      storageRoot: repository,
      config: defaultConfig(),
    });
    const db = new TokenFaxxDatabase(
      path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
    );
    const bundle = db.getBundle(result.id);
    expect(bundle?.outcome).toMatchObject({
      status: "attempted",
      reason: "No Git change evidence was observed for a feature task",
    });
    expect(
      bundle?.events.filter((item) => item.eventType === "file.changed"),
    ).toHaveLength(0);
    expect(bundle?.gitSnapshots.at(-1)).toMatchObject({
      changedFileCount: 0,
      uncommittedChanges: false,
    });
    db.close();
  });

  it("terminates and records an agent that exceeds its deadline", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-timeout-"),
    );
    directories.push(repository);
    spawnSync("git", ["init"], { cwd: repository, stdio: "ignore" });
    const started = Date.now();
    const result = await runTracked({
      command: 'node -e "setInterval(()=>{},10000)"',
      timeoutMs: 100,
      repository,
      storageRoot: repository,
      config: defaultConfig(),
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.exitCode).toBe(124);
    const db = new TokenFaxxDatabase(
      path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
    );
    const bundle = db.getBundle(result.id);
    expect(bundle?.session).toMatchObject({
      status: "failed",
      childProcessExitCode: null,
    });
    expect(bundle?.outcome).toMatchObject({
      status: "failed",
      reason: "Agent exceeded the 100ms time limit",
    });
    expect(
      bundle?.events.find(
        (item) =>
          item.eventType === "command.completed" &&
          item.payload.category === "agent",
      )?.payload.status,
    ).toBe("timed-out");
    db.close();
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
