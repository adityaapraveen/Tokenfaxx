import { z } from "zod";

export const benchmarkDefinitionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  repository: z.string().min(1),
  startingCommit: z.string().min(1),
  timeoutMs: z.number().int().positive().max(86_400_000).default(900_000),
  validation: z
    .object({
      test: z.string().min(1).optional(),
      build: z.string().min(1).optional(),
      lint: z.string().min(1).optional(),
      typecheck: z.string().min(1).optional(),
    })
    .default({}),
  expectedOutcome: z.object({
    testsPass: z.boolean().optional(),
    buildPasses: z.boolean().optional(),
    lintPasses: z.boolean().optional(),
    typecheckPasses: z.boolean().optional(),
  }),
  maximumCostUsd: z.number().nonnegative().optional(),
  tags: z.array(z.string()).default([]),
});
export type BenchmarkDefinition = z.infer<typeof benchmarkDefinitionSchema>;
