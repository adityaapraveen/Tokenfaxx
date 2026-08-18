import { z } from "zod";

const validationCommandSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(3_600_000).default(120_000),
  enabled: z.boolean().default(true),
  parser: z
    .enum(["auto", "vitest", "jest", "junit", "eslint", "typescript", "none"])
    .default("auto"),
  resultFile: z.string().optional(),
});
const weightsSchema = z
  .object({
    outcome: z.number().min(0).max(1),
    validationQuality: z.number().min(0).max(1),
    tokenEfficiency: z.number().min(0).max(1),
    costEfficiency: z.number().min(0).max(1),
    rework: z.number().min(0).max(1),
    attributionConfidence: z.number().min(0).max(1),
  })
  .refine(
    (weights) =>
      Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 0.0001,
    "Scoring weights must total 1",
  );
export const defaultWeights = {
  outcome: 0.3,
  validationQuality: 0.25,
  tokenEfficiency: 0.15,
  costEfficiency: 0.1,
  rework: 0.1,
  attributionConfidence: 0.1,
} as const;
export const configSchema = z.object({
  project: z.object({ name: z.string().min(1).optional() }).default({}),
  collection: z
    .object({
      gitSampleIntervalMs: z.number().int().min(1000).max(60000).default(3000),
      maxValidationOutputBytes: z
        .number()
        .int()
        .positive()
        .max(5_000_000)
        .default(500_000),
    })
    .default({}),
  validation: z
    .object({
      test: validationCommandSchema.optional(),
      build: validationCommandSchema.optional(),
      lint: validationCommandSchema.optional(),
      typecheck: validationCommandSchema.optional(),
    })
    .default({}),
  scoring: z
    .object({ weights: weightsSchema.default(defaultWeights) })
    .default({ weights: defaultWeights }),
  privacy: z
    .object({
      storePrompts: z.literal(false).default(false),
      storeResponses: z.literal(false).default(false),
      storeTerminalOutput: z.literal(false).default(false),
      storeDiffContents: z.literal(false).default(false),
      retentionDays: z.number().int().positive().optional(),
    })
    .default({}),
  pricing: z
    .object({
      custom: z
        .array(
          z.object({
            provider: z.string(),
            model: z.string(),
            inputPerMillionUsd: z.number().nonnegative(),
            outputPerMillionUsd: z.number().nonnegative(),
            cachedInputPerMillionUsd: z.number().nonnegative().optional(),
            effectiveDate: z.string().optional(),
            source: z.string().optional(),
          }),
        )
        .superRefine((prices, context) => {
          const seen = new Set<string>();
          prices.forEach((price, index) => {
            const key = `${price.provider}\u0000${price.model}`;
            if (seen.has(key))
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate pricing for ${price.provider}/${price.model}`,
                path: [index],
              });
            seen.add(key);
          });
        })
        .default([]),
    })
    .default({ custom: [] }),
  analysis: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.literal("openrouter").default("openrouter"),
      model: z.string().min(1).default("openai/gpt-4o-mini"),
      timeoutMs: z.number().int().positive().max(120000).default(30000),
      maxCostUsd: z.number().positive().default(0.05),
      sendSourceCode: z.literal(false).default(false),
      sendDiffContents: z.literal(false).default(false),
      sendPrompts: z.literal(false).default(false),
    })
    .default({}),
});
export type TokenFaxxConfig = z.infer<typeof configSchema>;
export const defineConfig = (
  config: z.input<typeof configSchema>,
): TokenFaxxConfig => configSchema.parse(config);
export const defaultConfig = (): TokenFaxxConfig => configSchema.parse({});
