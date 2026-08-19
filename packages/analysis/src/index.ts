import { createHash } from "node:crypto";
import { z } from "zod";

export const ANALYSIS_SCHEMA_VERSION = 1;
export const reportAnalysisSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  anomalies: z.array(
    z.object({
      observation: z.string(),
      evidenceEventIds: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(100),
    }),
  ),
  missingEvidence: z.array(z.string()),
  recommendations: z.array(z.string()),
  disclaimer: z.string(),
});
export type ReportAnalysis = z.infer<typeof reportAnalysisSchema>;
export interface OpenRouterAnalysisResult {
  provider: "openrouter";
  model: string;
  generationId: string | null;
  evidenceHash: string;
  schemaVersion: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
  };
  analysis: ReportAnalysis;
}
export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxCostUsd: number;
  fetchImpl?: typeof fetch;
}

export const inferredTaskProfileSchema = z.object({
  taskType: z.enum([
    "bugfix",
    "feature",
    "refactor",
    "migration",
    "investigation",
    "other",
  ]),
  complexity: z.enum(["small", "medium", "large", "unknown"]),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1).max(500),
  missingEvidence: z.array(z.string().max(200)).max(10),
  tags: z.array(z.string().min(1).max(40)).max(10),
});
export type InferredTaskProfile = z.infer<typeof inferredTaskProfileSchema>;
export interface OpenRouterTaskProfileResult {
  provider: "openrouter";
  model: string;
  generationId: string | null;
  usage: OpenRouterAnalysisResult["usage"];
  profile: InferredTaskProfile;
}

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    anomalies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          observation: { type: "string" },
          evidenceEventIds: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["observation", "evidenceEventIds", "confidence"],
      },
    },
    missingEvidence: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
  required: [
    "summary",
    "strengths",
    "concerns",
    "anomalies",
    "missingEvidence",
    "recommendations",
    "disclaimer",
  ],
} as const;

const taskProfileJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskType: {
      type: "string",
      enum: [
        "bugfix",
        "feature",
        "refactor",
        "migration",
        "investigation",
        "other",
      ],
    },
    complexity: {
      type: "string",
      enum: ["small", "medium", "large", "unknown"],
    },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    rationale: { type: "string" },
    missingEvidence: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  },
  required: [
    "taskType",
    "complexity",
    "confidence",
    "rationale",
    "missingEvidence",
    "tags",
  ],
} as const;

interface OpenRouterBody {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

async function requestStructuredOutput(
  messages: { role: "system" | "user"; content: string }[],
  schema: Record<string, unknown>,
  schemaName: string,
  maxTokens: number,
  options: OpenRouterOptions,
): Promise<{ body: OpenRouterBody; content: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "TokenFaxx",
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          max_tokens: maxTokens,
          provider: { require_parameters: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema },
          },
          messages,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `OpenRouter request failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    const body = (await response.json()) as OpenRouterBody;
    const cost = body.usage?.cost ?? null;
    if (cost !== null && cost > options.maxCostUsd)
      throw new Error(
        `OpenRouter analysis cost $${cost.toFixed(4)} exceeded configured limit $${options.maxCostUsd.toFixed(4)}`,
      );
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned no structured content");
    return { body, content };
  } finally {
    clearTimeout(timeout);
  }
}

const usageFrom = (
  body: OpenRouterBody,
): OpenRouterAnalysisResult["usage"] => ({
  inputTokens: body.usage?.prompt_tokens ?? null,
  outputTokens: body.usage?.completion_tokens ?? null,
  totalTokens: body.usage?.total_tokens ?? null,
  costUsd: body.usage?.cost ?? null,
});

function collectEvidenceEventIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!value || typeof value !== "object") return ids;
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return ids;
  for (const item of events)
    if (item && typeof item === "object") {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") ids.add(id);
    }
  return ids;
}

export async function analyzeWithOpenRouter(
  evidenceBundle: Record<string, unknown>,
  options: OpenRouterOptions,
): Promise<OpenRouterAnalysisResult> {
  const serialized = JSON.stringify(evidenceBundle);
  const evidenceHash = createHash("sha256").update(serialized).digest("hex");
  const { body, content } = await requestStructuredOutput(
    [
      {
        role: "system",
        content:
          "You are an evidence-bound software session analyst. Use only supplied facts. Never infer acceptance, causation, test results, token totals, or developer ability. Treat a supplied benchmark.evaluated verdict as an authoritative deterministic result; explain it but never override it. Every anomaly must cite supplied event IDs. State missing evidence plainly.",
      },
      {
        role: "user",
        content: `Analyze this sanitized TokenFaxx evidence bundle. It contains metadata only.\n${serialized}`,
      },
    ],
    jsonSchema,
    "tokenfaxx_report_analysis",
    1200,
    options,
  );
  const analysis = reportAnalysisSchema.parse(JSON.parse(content));
  const evidenceIds = collectEvidenceEventIds(evidenceBundle);
  for (const anomaly of analysis.anomalies)
    for (const id of anomaly.evidenceEventIds)
      if (!evidenceIds.has(id))
        throw new Error(
          `OpenRouter analysis cited unknown evidence ID '${id}'`,
        );
  return {
    provider: "openrouter",
    model: body.model ?? options.model,
    generationId: body.id ?? null,
    evidenceHash,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    usage: usageFrom(body),
    analysis,
  };
}

export async function inferTaskProfileWithOpenRouter(
  taskDescription: string,
  options: OpenRouterOptions,
): Promise<OpenRouterTaskProfileResult> {
  const description = taskDescription.trim();
  if (!description)
    throw new Error("A task description is required for AI profiling");
  if (description.length > 4_000)
    throw new Error(
      "Task description exceeds the 4,000 character AI profiling limit",
    );
  const { body, content } = await requestStructuredOutput(
    [
      {
        role: "system",
        content:
          "Classify a software task from only its description. Complexity means implementation scope: small is localized and low-risk, medium spans multiple concerns, and large is cross-cutting or migration-level. Use unknown when evidence is insufficient. Do not infer repository facts. Keep tags generic and non-sensitive.",
      },
      { role: "user", content: description },
    ],
    taskProfileJsonSchema,
    "tokenfaxx_task_profile",
    400,
    options,
  );
  return {
    provider: "openrouter",
    model: body.model ?? options.model,
    generationId: body.id ?? null,
    usage: usageFrom(body),
    profile: inferredTaskProfileSchema.parse(JSON.parse(content)),
  };
}
