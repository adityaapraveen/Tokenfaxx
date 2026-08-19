import { describe, expect, it } from "vitest";
import type { BenchmarkVerdict } from "@tokenfaxx/core";
import {
  BENCHMARK_EXPECTATION_FAILED_EXIT_CODE,
  assessBenchmarkComparison,
  benchmarkExitCode,
  runBenchmarkSetup,
} from "./benchmark.js";

const verdict = (passed: boolean): BenchmarkVerdict => ({
  benchmarkId: "migration",
  definitionHashVersion: 1,
  definitionHash: "a".repeat(64),
  resolvedStartingCommit: "abc123",
  setup: { status: "not-configured", durationMs: 0 },
  passed,
  checks: [
    {
      expectation: "testsPass",
      validationType: "test",
      expected: true,
      actual: passed,
      validationStatus: passed ? "passed" : "failed",
      status: passed ? "met" : "unmet",
    },
  ],
});

describe("benchmark command result", () => {
  it("uses a distinct exit code when deterministic expectations fail", () => {
    expect(benchmarkExitCode(0, verdict(false))).toBe(
      BENCHMARK_EXPECTATION_FAILED_EXIT_CODE,
    );
    expect(benchmarkExitCode(0, verdict(true))).toBe(0);
  });

  it("preserves interruption and agent failures when expectations pass", () => {
    expect(benchmarkExitCode(130, verdict(false))).toBe(130);
    expect(benchmarkExitCode(7, verdict(true))).toBe(7);
  });

  it("runs an explicit setup command and rejects setup failures", () => {
    expect(
      runBenchmarkSetup(
        `"${process.execPath}" -e "process.exit(0)"`,
        process.cwd(),
        5_000,
      ),
    ).toEqual({ status: "passed", durationMs: expect.any(Number) });
    expect(() =>
      runBenchmarkSetup(
        `"${process.execPath}" -e "process.exit(3)"`,
        process.cwd(),
        5_000,
      ),
    ).toThrow(/exit code 3/);
  });

  it("refuses high-confidence comparison when benchmark definitions differ", () => {
    expect(
      assessBenchmarkComparison(
        { benchmarkId: "migration", benchmarkDefinitionHash: "hash-a" },
        { benchmarkId: "migration", benchmarkDefinitionHash: "hash-b" },
        true,
        true,
      ),
    ).toEqual({
      comparisonConfidence: 40,
      basis: {
        sameBenchmarkId: true,
        sameBenchmarkDefinition: false,
        sameTask: true,
        sameStartingCommit: true,
      },
    });
    expect(
      assessBenchmarkComparison(
        { benchmarkId: "migration", benchmarkDefinitionHash: "hash-a" },
        { benchmarkId: "migration", benchmarkDefinitionHash: "hash-a" },
        true,
        true,
      ).comparisonConfidence,
    ).toBe(100);
  });
});
