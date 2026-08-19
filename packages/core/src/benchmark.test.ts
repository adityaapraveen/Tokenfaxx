import { describe, expect, it } from "vitest";
import {
  benchmarkDefinitionSchema,
  evaluateBenchmarkExpectations,
  hashBenchmarkDefinition,
} from "./benchmark.js";

const definition = benchmarkDefinitionSchema.parse({
  id: "notification-migration",
  description: "Fix notification migration",
  repository: ".",
  startingCommit: "main",
  validation: {
    test: "pnpm test",
    typecheck: "pnpm typecheck",
  },
  expectedOutcome: {
    testsPass: true,
    typecheckPasses: true,
  },
  tags: ["migration"],
});

describe("benchmark verdicts", () => {
  it("hashes normalized definitions and the resolved starting commit", () => {
    const reordered = benchmarkDefinitionSchema.parse({
      tags: ["migration"],
      expectedOutcome: {
        typecheckPasses: true,
        testsPass: true,
      },
      validation: {
        typecheck: "pnpm typecheck",
        test: "pnpm test",
      },
      startingCommit: "main",
      repository: ".",
      description: "Fix notification migration",
      id: "notification-migration",
    });

    expect(hashBenchmarkDefinition(reordered, "abc123")).toBe(
      "400025ef3a4e76209752c5cbf1941fbb4d369949b342ae20de3f32e4f17433cc",
    );
    expect(hashBenchmarkDefinition(definition, "abc123")).toBe(
      hashBenchmarkDefinition(reordered, "abc123"),
    );
    expect(hashBenchmarkDefinition(definition, "different-commit")).not.toBe(
      hashBenchmarkDefinition(definition, "abc123"),
    );
  });

  it("passes only when every declared expectation matches observed evidence", () => {
    const hash = hashBenchmarkDefinition(definition, "abc123");
    const verdict = evaluateBenchmarkExpectations(definition, hash, "abc123", [
      { type: "test", status: "passed" },
      { type: "typecheck", status: "passed" },
    ]);

    expect(verdict.passed).toBe(true);
    expect(verdict.checks).toEqual([
      expect.objectContaining({
        expectation: "testsPass",
        actual: true,
        status: "met",
      }),
      expect.objectContaining({
        expectation: "typecheckPasses",
        actual: true,
        status: "met",
      }),
    ]);
  });

  it("distinguishes mismatched expectations from missing evidence", () => {
    const hash = hashBenchmarkDefinition(definition, "abc123");
    const verdict = evaluateBenchmarkExpectations(definition, hash, "abc123", [
      { type: "test", status: "failed" },
    ]);

    expect(verdict.passed).toBe(false);
    expect(verdict.checks).toEqual([
      expect.objectContaining({
        expectation: "testsPass",
        actual: false,
        status: "unmet",
      }),
      expect.objectContaining({
        expectation: "typecheckPasses",
        actual: null,
        validationStatus: null,
        status: "missing",
      }),
    ]);
  });

  it("rejects benchmarks without an expectation or with misspelled keys", () => {
    expect(() =>
      benchmarkDefinitionSchema.parse({
        ...definition,
        expectedOutcome: {},
      }),
    ).toThrow(/at least one expectation/);
    expect(() =>
      benchmarkDefinitionSchema.parse({
        ...definition,
        expectedOutcome: { testPass: true },
      }),
    ).toThrow();
  });

  it("requires every validation and expectation to have a matching pair", () => {
    expect(() =>
      benchmarkDefinitionSchema.parse({
        ...definition,
        validation: { test: "pnpm test" },
        expectedOutcome: {
          testsPass: true,
          typecheckPasses: true,
        },
      }),
    ).toThrow(/typecheckPasses requires validation.typecheck/);
    expect(() =>
      benchmarkDefinitionSchema.parse({
        ...definition,
        validation: {
          test: "pnpm test",
          typecheck: "pnpm typecheck",
        },
        expectedOutcome: { testsPass: true },
      }),
    ).toThrow(/validation.typecheck requires expectedOutcome.typecheckPasses/);
  });
});
