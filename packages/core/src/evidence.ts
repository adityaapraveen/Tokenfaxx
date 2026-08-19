import { z } from "zod";
import { BENCHMARK_DEFINITION_HASH_VERSION } from "./benchmark.js";

export const measurementSchema = z.enum([
  "observed",
  "provider-reported",
  "calculated",
  "inferred",
  "llm-inferred",
]);
export type EvidenceMeasurement = z.infer<typeof measurementSchema>;
export interface EvidenceValue<T> {
  value: T | null;
  measurement: EvidenceMeasurement;
  source: string;
  confidence: number;
  observedAt: string;
  limitations: string[];
  eventIds?: string[];
}
export function evidence<T>(
  value: T | null,
  measurement: EvidenceMeasurement,
  source: string,
  confidence: number,
  limitations: string[] = [],
  eventIds?: string[],
): EvidenceValue<T> {
  return {
    value,
    measurement,
    source,
    confidence: Math.max(0, Math.min(100, confidence)),
    observedAt: new Date().toISOString(),
    limitations,
    ...(eventIds?.length ? { eventIds } : {}),
  };
}
export const taskOutcomeStatuses = [
  "unknown",
  "attempted",
  "partially-completed",
  "completed-unverified",
  "completed-validated",
  "accepted",
  "rejected",
  "failed",
] as const;
export type TaskOutcomeStatus = (typeof taskOutcomeStatuses)[number];
export const taskProfileSchema = z.object({
  benchmarkId: z.string().optional(),
  benchmarkDefinitionHashVersion: z
    .literal(BENCHMARK_DEFINITION_HASH_VERSION)
    .optional(),
  benchmarkDefinitionHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  benchmarkStartingCommit: z.string().min(1).optional(),
  taskType: z
    .enum([
      "bugfix",
      "feature",
      "refactor",
      "migration",
      "investigation",
      "other",
    ])
    .default("other"),
  expectedFiles: z.number().int().positive().optional(),
  validationCount: z.number().int().nonnegative().default(0),
  complexity: z
    .enum(["small", "medium", "large", "unknown"])
    .default("unknown"),
  complexitySource: z
    .enum(["user", "benchmark", "llm-inferred", "unknown"])
    .default("unknown"),
  tags: z.array(z.string()).default([]),
  maximumCostUsd: z.number().nonnegative().optional(),
  confidence: z.number().min(0).max(100).optional(),
  rationale: z.string().max(500).optional(),
  missingEvidence: z.array(z.string()).optional(),
  model: z.string().optional(),
  inference: z
    .object({
      provider: z.literal("openrouter"),
      generationId: z.string().nullable(),
      inputTokens: z.number().int().nonnegative().nullable(),
      outputTokens: z.number().int().nonnegative().nullable(),
      totalTokens: z.number().int().nonnegative().nullable(),
      costUsd: z.number().nonnegative().nullable(),
    })
    .optional(),
});
export type TaskProfile = z.infer<typeof taskProfileSchema>;
