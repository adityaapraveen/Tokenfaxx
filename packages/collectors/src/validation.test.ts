import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runValidation } from "./index.js";
describe("validation", () => {
  it("captures failure", async () =>
    expect(
      (
        await runValidation(
          "test",
          'node -e "process.exit(2)"',
          1000,
          process.cwd(),
        )
      ).status,
    ).toBe("failed"));
  it("times out", async () =>
    expect(
      (
        await runValidation(
          "test",
          'node -e "setTimeout(()=>{},1000)"',
          25,
          process.cwd(),
        )
      ).status,
    ).toBe("timed-out"));
  it("rejects result files outside the validation directory", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-validation-root-"),
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-validation-outside-"),
    );
    fs.writeFileSync(path.join(outside, "results.json"), "{}");
    const result = await runValidation(
      "test",
      `node -e "process.exit(0)"`,
      1000,
      directory,
      { parser: "jest", resultFile: path.join(outside, "results.json") },
    );
    expect(result.details.source).toBe("exit-code");
    expect(result.details.limitations[0]).toContain(
      "escapes the validation working directory",
    );
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it("rejects result-file symlinks that escape the validation directory", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-validation-root-"),
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-validation-outside-"),
    );
    const target = path.join(outside, "results.json");
    fs.writeFileSync(target, "{}");
    fs.symlinkSync(target, path.join(directory, "results.json"));
    const result = await runValidation(
      "test",
      `node -e "process.exit(0)"`,
      1000,
      directory,
      { parser: "jest", resultFile: "results.json" },
    );
    expect(result.details.limitations[0]).toContain(
      "escapes the validation working directory",
    );
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it("extracts machine-readable test counts", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tokenfaxx-validation-"),
    );
    fs.writeFileSync(
      path.join(directory, "results.json"),
      JSON.stringify({
        numPassedTestSuites: 2,
        numFailedTestSuites: 0,
        numPassedTests: 12,
        numFailedTests: 0,
        numPendingTests: 1,
      }),
    );
    const result = await runValidation(
      "test",
      `node -e "process.exit(0)"`,
      1000,
      directory,
      { parser: "jest", resultFile: "results.json" },
    );
    expect(result.details.testsPassed).toBe(12);
    expect(result.details.testsSkipped).toBe(1);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
