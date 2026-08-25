import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";
import { program } from "./index.js";

const directories: string[] = [];
afterEach(() => {
  process.exitCode = undefined;
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const git = (repository: string, args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

describe("benchmark CLI", () => {
  it("persists setup failures without launching the agent", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-benchmark-setup-failure-"),
    );
    directories.push(repository);
    git(repository, ["init"]);
    git(repository, ["config", "user.email", "test@example.com"]);
    git(repository, ["config", "user.name", "TokenFaxx Test"]);
    fs.writeFileSync(path.join(repository, "seed.txt"), "seed\n");
    const definition = {
      id: "setup-failure",
      description: "This agent must not run",
      repository: ".",
      startingCommit: "HEAD",
      timeoutMs: 5_000,
      setup: `${JSON.stringify(process.execPath)} -e "process.exit(3)"`,
      validation: {
        test: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      },
      expectedOutcome: { testsPass: true },
      tags: [],
    };
    const definitionFile = path.join(repository, "benchmark.json");
    fs.writeFileSync(
      definitionFile,
      `${JSON.stringify(definition, null, 2)}\n`,
    );
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", "failing setup fixture"]);
    const previousCwd = process.cwd();
    process.chdir(repository);
    try {
      await program.parseAsync([
        process.execPath,
        "tokenfaxx",
        "benchmark",
        "run",
        "--task",
        definitionFile,
        "--command",
        `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('agent-ran.txt', 'bad')"`,
      ]);
    } finally {
      process.chdir(previousCwd);
    }
    expect(process.exitCode).toBe(2);
    const db = new TokenFaxxDatabase(
      path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
    );
    const session = db.listSessions({ taskId: definition.id, limit: 1 })[0];
    const bundle = db.getBundle(session!.id);
    expect(bundle?.outcome).toMatchObject({
      status: "failed",
      reason: "Benchmark setup failed",
    });
    expect(
      bundle?.events.find((event) => event.eventType === "benchmark.evaluated")
        ?.payload,
    ).toMatchObject({ passed: false, setup: { status: "failed" } });
    expect(
      bundle?.events.some(
        (event) =>
          event.eventType === "command.completed" &&
          event.payload.category === "agent",
      ),
    ).toBe(false);
    const worktree = bundle?.events[0]?.repository;
    db.close();
    if (worktree) git(repository, ["worktree", "remove", "--force", worktree]);
  });

  it("runs a custom command against the resolved starting commit", async () => {
    const repository = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-benchmark-cli-"),
    );
    directories.push(repository);
    git(repository, ["init"]);
    git(repository, ["config", "user.email", "test@example.com"]);
    git(repository, ["config", "user.name", "TokenFaxx Test"]);
    fs.writeFileSync(path.join(repository, "seed.txt"), "seed\n");
    const definition = {
      id: "custom-command",
      description: "Create the endpoint marker",
      repository: ".",
      startingCommit: "HEAD",
      timeoutMs: 5_000,
      validation: {
        test: `${JSON.stringify(process.execPath)} -e "process.exit(require('node:fs').existsSync('endpoint.txt') ? 0 : 1)"`,
      },
      expectedOutcome: { testsPass: true },
      tags: ["cli-test"],
    };
    const definitionFile = path.join(repository, "benchmark.json");
    fs.writeFileSync(
      definitionFile,
      `${JSON.stringify(definition, null, 2)}\n`,
    );
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", "benchmark fixture"]);
    const startingCommit = git(repository, ["rev-parse", "HEAD"]);
    const previousCwd = process.cwd();
    process.chdir(repository);
    try {
      await program.parseAsync([
        process.execPath,
        "tokenfaxx",
        "benchmark",
        "run",
        "--task",
        definitionFile,
        "--command",
        `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('endpoint.txt', 'ok')"`,
      ]);
    } finally {
      process.chdir(previousCwd);
    }
    expect(process.exitCode ?? 0).toBe(0);
    const db = new TokenFaxxDatabase(
      path.join(repository, ".tokenfaxx", "tokenfaxx.db"),
    );
    const session = db.listSessions({ taskId: definition.id, limit: 1 })[0];
    expect(session).toBeDefined();
    const bundle = db.getBundle(session!.id);
    expect(bundle?.outcome?.status).toBe("completed-validated");
    expect(
      bundle?.events.find((event) => event.eventType === "task.profiled")
        ?.payload.benchmarkStartingCommit,
    ).toBe(startingCommit);
    expect(
      bundle?.events.find((event) => event.eventType === "benchmark.evaluated")
        ?.payload.passed,
    ).toBe(true);
    db.close();
  });
});
