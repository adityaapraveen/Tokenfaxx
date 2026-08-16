import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1 as const;
export const eventTypes = [
  "session.started",
  "session.completed",
  "model.usage",
  "tool.started",
  "tool.completed",
  "file.changed",
  "command.completed",
  "test.completed",
  "build.completed",
  "lint.completed",
  "typecheck.completed",
  "git.commit.created",
  "git.sampled",
  "task.profiled",
  "analysis.completed",
  "validation.completed",
  "task.outcome",
  "error",
] as const;
export type EventType = (typeof eventTypes)[number];

const nonnegativeInt = z.number().int().nonnegative();
const payloadSchemas = {
  "session.started": z.object({
    adapterVersion: z.string(),
    branch: z.string().nullable().optional(),
    headSha: z.string().nullable().optional(),
  }),
  "session.completed": z.object({
    status: z.enum(["completed", "failed", "interrupted"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
  }),
  "model.usage": z.object({
    provider: z.string(),
    model: z.string().nullable(),
    inputTokens: nonnegativeInt.nullable(),
    outputTokens: nonnegativeInt.nullable(),
    cachedInputTokens: nonnegativeInt.nullable().optional(),
    reasoningTokens: nonnegativeInt.nullable().optional(),
    totalTokens: nonnegativeInt.nullable().optional(),
    estimatedCostUsd: z.number().nonnegative().nullable().optional(),
    measurement: z.enum(["exact", "reported", "calculated", "estimated"]),
    source: z.string().optional(),
  }),
  "tool.started": z.object({ tool: z.string(), actionType: z.string() }),
  "tool.completed": z.object({
    tool: z.string(),
    actionType: z.string(),
    success: z.boolean(),
    durationMs: nonnegativeInt,
  }),
  "file.changed": z.object({
    path: z.string(),
    changeType: z.enum(["created", "modified", "deleted", "renamed"]),
    occurrences: nonnegativeInt.optional(),
  }),
  "command.completed": z.object({
    category: z.string(),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
    status: z.enum(["passed", "failed", "timed-out", "interrupted"]),
    retryNumber: nonnegativeInt.default(0),
  }),
  "test.completed": z.object({
    status: z.enum(["passed", "failed", "skipped", "timed-out"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
  }),
  "build.completed": z.object({
    status: z.enum(["passed", "failed", "skipped", "timed-out"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
  }),
  "lint.completed": z.object({
    status: z.enum(["passed", "failed", "skipped", "timed-out"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
  }),
  "typecheck.completed": z.object({
    status: z.enum(["passed", "failed", "skipped", "timed-out"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
  }),
  "git.commit.created": z.object({ sha: z.string() }),
  "git.sampled": z.object({
    sequence: nonnegativeInt,
    headSha: z.string().nullable(),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        index: z.string(),
        workingTree: z.string(),
        size: nonnegativeInt.nullable(),
        modifiedAtMs: nonnegativeInt.nullable(),
      }),
    ),
  }),
  "task.profiled": z.object({
    benchmarkId: z.string().optional(),
    taskType: z.string(),
    expectedFiles: nonnegativeInt.optional(),
    validationCount: nonnegativeInt,
    complexity: z.enum(["small", "medium", "large", "unknown"]),
    complexitySource: z.enum(["user", "benchmark", "llm-inferred", "unknown"]),
    tags: z.array(z.string()),
    maximumCostUsd: z.number().nonnegative().optional(),
    confidence: z.number().min(0).max(100).optional(),
    rationale: z.string().max(500).optional(),
    missingEvidence: z.array(z.string()).optional(),
    model: z.string().optional(),
    inference: z
      .object({
        provider: z.literal("openrouter"),
        generationId: z.string().nullable(),
        inputTokens: nonnegativeInt.nullable(),
        outputTokens: nonnegativeInt.nullable(),
        totalTokens: nonnegativeInt.nullable(),
        costUsd: z.number().nonnegative().nullable(),
      })
      .optional(),
  }),
  "analysis.completed": z.object({
    provider: z.literal("openrouter"),
    model: z.string(),
    generationId: z.string().nullable(),
    evidenceHash: z.string(),
    schemaVersion: nonnegativeInt,
    usage: z.object({
      inputTokens: nonnegativeInt.nullable(),
      outputTokens: nonnegativeInt.nullable(),
      totalTokens: nonnegativeInt.nullable(),
      costUsd: z.number().nonnegative().nullable(),
    }),
    analysis: z.record(z.unknown()),
  }),
  "validation.completed": z.object({
    validationType: z.enum(["test", "build", "lint", "typecheck"]),
    command: z.string(),
    status: z.enum(["passed", "failed", "skipped", "timed-out"]),
    exitCode: z.number().int().nullable(),
    durationMs: nonnegativeInt,
    details: z.record(z.unknown()).optional(),
  }),
  "task.outcome": z.object({
    status: z.enum([
      "unknown",
      "attempted",
      "partially-completed",
      "completed-unverified",
      "completed-validated",
      "accepted",
      "rejected",
      "failed",
      "completed",
      "partial",
    ]),
    accepted: z.boolean().nullable().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.string()).default([]),
  }),
  error: z.object({
    code: z.string(),
    message: z.string(),
    recoverable: z.boolean(),
  }),
} satisfies Record<EventType, z.ZodTypeAny>;

const envelope = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  sessionId: z.string().uuid(),
  timestamp: z.string().datetime(),
  agent: z.string().min(1),
  repository: z.string().min(1),
  taskId: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type TokenFaxxEvent = z.infer<typeof envelope> & {
  eventType: EventType;
  payload: Record<string, unknown>;
};
export function parseEvent(input: unknown): TokenFaxxEvent {
  const base = envelope
    .extend({ eventType: z.enum(eventTypes), payload: z.unknown() })
    .parse(input);
  const payload = payloadSchemas[base.eventType].parse(base.payload) as Record<
    string,
    unknown
  >;
  return { ...base, payload };
}
