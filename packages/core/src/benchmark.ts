import { createHash } from "node:crypto";
import { z } from "zod";

export const BENCHMARK_DEFINITION_HASH_VERSION = 1 as const;

export const benchmarkValidationTypeSchema = z.enum([
  "test",
  "build",
  "lint",
  "typecheck",
]);
export type BenchmarkValidationType = z.infer<
  typeof benchmarkValidationTypeSchema
>;

export const benchmarkExpectationSchema = z.enum([
  "testsPass",
  "buildPasses",
  "lintPasses",
  "typecheckPasses",
]);
export type BenchmarkExpectation = z.infer<typeof benchmarkExpectationSchema>;

const expectedOutcomeSchema = z
  .object({
    testsPass: z.boolean().optional(),
    buildPasses: z.boolean().optional(),
    lintPasses: z.boolean().optional(),
    typecheckPasses: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((expected) => expected !== undefined),
    "expectedOutcome must declare at least one expectation",
  );

export const benchmarkDefinitionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    repository: z.string().min(1),
    startingCommit: z.string().min(1),
    timeoutMs: z.number().int().positive().max(86_400_000).default(900_000),
    setup: z.string().min(1).optional(),
    validation: z
      .object({
        test: z.string().min(1).optional(),
        build: z.string().min(1).optional(),
        lint: z.string().min(1).optional(),
        typecheck: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    expectedOutcome: expectedOutcomeSchema,
    maximumCostUsd: z.number().nonnegative().optional(),
    tags: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((definition, context) => {
    const pairs = [
      ["test", "testsPass"],
      ["build", "buildPasses"],
      ["lint", "lintPasses"],
      ["typecheck", "typecheckPasses"],
    ] as const;
    for (const [validationType, expectation] of pairs) {
      const hasValidation = definition.validation[validationType] !== undefined;
      const hasExpectation =
        definition.expectedOutcome[expectation] !== undefined;
      if (hasExpectation && !hasValidation)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${expectation} requires validation.${validationType}`,
          path: ["validation", validationType],
        });
      if (hasValidation && !hasExpectation)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `validation.${validationType} requires expectedOutcome.${expectation}`,
          path: ["expectedOutcome", expectation],
        });
    }
  });
export type BenchmarkDefinition = z.infer<typeof benchmarkDefinitionSchema>;

export const benchmarkCheckSchema = z.object({
  expectation: benchmarkExpectationSchema,
  validationType: benchmarkValidationTypeSchema,
  expected: z.boolean(),
  actual: z.boolean().nullable(),
  validationStatus: z
    .enum(["passed", "failed", "skipped", "timed-out"])
    .nullable(),
  status: z.enum(["met", "unmet", "missing"]),
});
export type BenchmarkCheck = z.infer<typeof benchmarkCheckSchema>;

export const benchmarkVerdictSchema = z.object({
  benchmarkId: z.string().min(1),
  definitionHashVersion: z.literal(BENCHMARK_DEFINITION_HASH_VERSION),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  resolvedStartingCommit: z.string().min(1),
  setup: z.object({
    status: z.enum(["passed", "not-configured"]),
    durationMs: z.number().int().nonnegative(),
  }),
  passed: z.boolean(),
  checks: z.array(benchmarkCheckSchema).min(1),
});
export type BenchmarkVerdict = z.infer<typeof benchmarkVerdictSchema>;

export interface BenchmarkValidationObservation {
  type: string;
  status: string;
}

export interface BenchmarkSetupObservation {
  status: "passed" | "not-configured";
  durationMs: number;
}

const expectations: {
  expectation: BenchmarkExpectation;
  validationType: BenchmarkValidationType;
}[] = [
  { expectation: "testsPass", validationType: "test" },
  { expectation: "buildPasses", validationType: "build" },
  { expectation: "lintPasses", validationType: "lint" },
  { expectation: "typecheckPasses", validationType: "typecheck" },
];

function canonicalJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    return item;
  };
  return JSON.stringify(canonicalize(value));
}

export function hashBenchmarkDefinition(
  definition: BenchmarkDefinition,
  resolvedStartingCommit: string,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        definitionHashVersion: BENCHMARK_DEFINITION_HASH_VERSION,
        definition,
        resolvedStartingCommit,
      }),
    )
    .digest("hex");
}

export function evaluateBenchmarkExpectations(
  definition: BenchmarkDefinition,
  definitionHash: string,
  resolvedStartingCommit: string,
  validations: BenchmarkValidationObservation[],
  setup: BenchmarkSetupObservation = {
    status: "not-configured",
    durationMs: 0,
  },
): BenchmarkVerdict {
  const statuses = new Map(validations.map((item) => [item.type, item.status]));
  const checks = expectations.flatMap(
    ({ expectation, validationType }): BenchmarkCheck[] => {
      const expected = definition.expectedOutcome[expectation];
      if (expected === undefined) return [];
      const rawStatus = statuses.get(validationType);
      const validationStatus =
        rawStatus === "passed" ||
        rawStatus === "failed" ||
        rawStatus === "skipped" ||
        rawStatus === "timed-out"
          ? rawStatus
          : null;
      const actual =
        validationStatus === "passed"
          ? true
          : validationStatus === "failed" || validationStatus === "timed-out"
            ? false
            : null;
      return [
        {
          expectation,
          validationType,
          expected,
          actual,
          validationStatus,
          status:
            actual === null ? "missing" : actual === expected ? "met" : "unmet",
        },
      ];
    },
  );
  return benchmarkVerdictSchema.parse({
    benchmarkId: definition.id,
    definitionHashVersion: BENCHMARK_DEFINITION_HASH_VERSION,
    definitionHash,
    resolvedStartingCommit,
    setup,
    passed: checks.every((check) => check.status === "met"),
    checks,
  });
}
