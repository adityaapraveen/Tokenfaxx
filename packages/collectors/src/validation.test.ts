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
