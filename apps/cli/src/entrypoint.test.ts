import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectExecution } from "./index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI entrypoint detection", () => {
  it("recognizes a package-manager symlink as direct execution", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-entrypoint-"),
    );
    directories.push(directory);
    const modulePath = path.join(directory, "index.js");
    const binPath = path.join(directory, "tokenfaxx");
    fs.writeFileSync(modulePath, "");
    fs.symlinkSync(modulePath, binPath);

    expect(isDirectExecution(binPath, pathToFileURL(modulePath).href)).toBe(
      true,
    );
  });

  it("does not treat an importing process as direct execution", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-entrypoint-"),
    );
    directories.push(directory);
    const modulePath = path.join(directory, "index.js");
    const importerPath = path.join(directory, "test-runner.js");
    fs.writeFileSync(modulePath, "");
    fs.writeFileSync(importerPath, "");

    expect(
      isDirectExecution(importerPath, pathToFileURL(modulePath).href),
    ).toBe(false);
  });
});
