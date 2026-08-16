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
