import {
  benchmarkVerdictSchema,
  evidence,
  type BenchmarkVerdict,
  type EvidenceMeasurement,
  type EvidenceValue,
} from "@tokenfaxx/core";
import type { SessionBundle } from "@tokenfaxx/storage";
import { csvEscape } from "@tokenfaxx/shared";

interface ValidationReport {
  id: string;
  type: string;
  status: string;
  exitCode: number | null;
  durationMs: number;
  details: {
    testsPassed?: number | null;
    testsFailed?: number | null;
    testsSkipped?: number | null;
    diagnostics?: number | null;
    warnings?: number | null;
    limitations: string[];
  };
}
interface ScoreReport {
  finalScore: number | null;
  confidence: number;
  insufficientData: boolean;
  components: {
    name: string;
    normalized: number | null;
    weight: number;
    contribution: number | null;
  }[];
  explanation: string[];
  reworkRate?: number | null;
  reworkEvidence?: string[];
  confidences?: { outcome: number; attribution: number; overall: number };
  attribution?: { wording: string; missingEvidence: string[] };
}
interface ReportData {
  session: {
    id: string;
    agent: string;
    taskId: string | null;
    taskDescription: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  process: {
    status: EvidenceValue<string>;
    exitCode: EvidenceValue<number>;
    durationMs: EvidenceValue<number>;
  };
  task: {
    outcome: EvidenceValue<string>;
    accepted: boolean | null;
    reason: string | null;
    evidence: string[];
    profile: Record<string, unknown> | null;
  };
  benchmark: BenchmarkVerdict | null;
  validation: ValidationReport[];
  usage: {
    inputTokens: EvidenceValue<number>;
    outputTokens: EvidenceValue<number>;
    cachedTokens: EvidenceValue<number>;
    reasoningTokens: EvidenceValue<number>;
    totalTokens: EvidenceValue<number>;
    estimatedCostUsd: EvidenceValue<number>;
    measurement: string | null;
    costMeasurement: string | null;
  };
  git: {
    filesChanged: EvidenceValue<number>;
    commitsCreated: EvidenceValue<number>;
    linesAdded: EvidenceValue<number>;
    linesDeleted: EvidenceValue<number>;
    uncommittedChanges: boolean | null;
    [key: string]: unknown;
  };
  score: ScoreReport | null;
  analysis: {
    provider: string;
    model: string;
    generationId: string | null;
    evidenceHash: string;
    schemaVersion: number;
    usage: unknown;
    result: {
      summary: string;
      strengths: string[];
      concerns: string[];
      anomalies: {
        observation: string;
        evidenceEventIds: string[];
        confidence: number;
      }[];
      missingEvidence: string[];
      recommendations: string[];
      disclaimer: string;
    };
    createdAt: string;
    authority: string;
  } | null;
  privacy: Record<string, boolean>;
}

const unavailable = "Unavailable";
const fmt = (value: number | null | undefined): string =>
  value == null ? unavailable : value.toLocaleString();
const duration = (ms: number | null): string =>
  ms == null
    ? unavailable
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(2)}s`;
function aggregate(
  bundle: SessionBundle,
  key:
    | "inputTokens"
    | "outputTokens"
    | "cachedTokens"
    | "reasoningTokens"
    | "totalTokens"
    | "estimatedCostUsd",
): number | null {
  if (!bundle.usage.length || bundle.usage.some((item) => item[key] == null))
    return null;
  return bundle.usage.reduce((sum, item) => sum + (item[key] ?? 0), 0);
}
const evidenceMetric = <T>(
  value: T | null,
  source: string,
  confidence: number,
  limitations: string[] = [],
): EvidenceValue<T> =>
  evidence(
    value,
    value === null ? "inferred" : "observed",
    source,
    confidence,
    limitations,
  );

export function reportObject(bundle: SessionBundle): ReportData {
  const before = bundle.gitSnapshots.find(
    (item) => item.snapshotType === "before",
  );
  const after = bundle.gitSnapshots.find(
    (item) => item.snapshotType === "after",
  );
  const profile =
    bundle.events.find((item) => item.eventType === "task.profiled")?.payload ??
    null;
  const fileEvents = bundle.events.filter(
    (item) => item.eventType === "file.changed",
  );
  const commits = bundle.events.filter(
    (item) => item.eventType === "git.commit.created",
  );
  const usageMeasurement = bundle.usage.length
    ? [...new Set(bundle.usage.map((item) => item.measurementType))].join(",")
    : null;
  const usageSource = bundle.usage.length
    ? [...new Set(bundle.usage.map((item) => item.source ?? "adapter"))].join(
        ", ",
      )
    : "adapter did not report usage";
  const usageLimitations = bundle.usage.length
    ? []
    : ["The selected adapter did not report token usage"];
  const costRows = bundle.usage.filter((item) => item.estimatedCostUsd != null);
  const costMeasurement = costRows.length
    ? [
        ...new Set(costRows.map((item) => item.costMeasurement ?? "unknown")),
      ].join(",")
    : null;
  const costEvidenceMeasurement: EvidenceMeasurement =
    costMeasurement === "provider-reported"
      ? "provider-reported"
      : costMeasurement === "calculated"
        ? "calculated"
        : "inferred";
  const costSource = costRows.length
    ? [
        ...new Set(costRows.map((item) => item.costSource ?? "unspecified")),
      ].join(", ")
    : "cost was not reported or calculable";
  const costConfidence = costRows.length
    ? Math.min(
        ...costRows.map((item) =>
          item.costMeasurement === "provider-reported"
            ? 100
            : item.costMeasurement === "calculated"
              ? 85
              : item.costMeasurement === "estimated"
                ? 55
                : 40,
        ),
      )
    : 0;
  const costLimitations = !costRows.length
    ? ["No cost was reported and no configured price matched"]
    : costRows.length !== bundle.usage.length
      ? [
          "One or more usage records have no cost; aggregate cost is unavailable",
        ]
      : costRows.some(
            (item) =>
              item.costMeasurement === "calculated" &&
              item.pricingEffectiveDate == null,
          )
        ? ["One or more calculated costs have no pricing effective date"]
        : [];
  const details = bundle.score
    ? (JSON.parse(bundle.score.detailsJson) as Record<string, unknown>)
    : {};
  const score = bundle.score
    ? {
        finalScore: bundle.score.finalScore,
        confidence: bundle.score.confidence,
        insufficientData: bundle.score.insufficientData,
        components: JSON.parse(bundle.score.components),
        explanation: JSON.parse(bundle.score.explanation),
        ...details,
      }
    : null;
  const outcomeEvidenceConfidence =
    (details.confidences as { outcome?: number } | undefined)?.outcome ??
    (bundle.outcome?.accepted == null ? 55 : 100);
  const latestAnalysis = bundle.analyses[0];
  const benchmarkEvent = [...bundle.events]
    .reverse()
    .find((item) => item.eventType === "benchmark.evaluated");
  return {
    session: {
      id: bundle.session.id,
      agent: bundle.session.agent,
      taskId: bundle.session.taskId,
      taskDescription: bundle.session.taskDescription,
      startedAt: bundle.session.startedAt,
      completedAt: bundle.session.completedAt,
    },
    process: {
      status: evidenceMetric(
        bundle.session.status,
        "child process lifecycle",
        100,
      ),
      exitCode: evidenceMetric(
        bundle.session.childProcessExitCode,
        "operating system",
        100,
      ),
      durationMs: evidenceMetric(
        bundle.session.durationMs,
        "monotonic session timestamps",
        100,
      ),
    },
    task: {
      outcome: bundle.outcome
        ? evidenceMetric(
            bundle.outcome.status,
            bundle.outcome.accepted == null
              ? "deterministic outcome rules"
              : "explicit user outcome",
            outcomeEvidenceConfidence,
            bundle.outcome.accepted == null
              ? ["No explicit acceptance result"]
              : [],
          )
        : evidenceMetric<string>(null, "no outcome evidence", 0, [
            "Session has no task outcome",
          ]),
      accepted: bundle.outcome?.accepted ?? null,
      reason: bundle.outcome?.reason ?? null,
      evidence: bundle.outcome ? JSON.parse(bundle.outcome.evidence) : [],
      profile,
    },
    benchmark: benchmarkEvent
      ? benchmarkVerdictSchema.parse(benchmarkEvent.payload)
      : null,
    validation: bundle.validations.map((item) => ({
      id: item.id,
      type: item.validationType,
      status: item.status,
      exitCode: item.exitCode,
      durationMs: item.durationMs,
      details: JSON.parse(item.detailsJson),
    })),
    usage: {
      inputTokens: evidenceMetric(
        aggregate(bundle, "inputTokens"),
        usageSource,
        aggregate(bundle, "inputTokens") === null ? 0 : 100,
        usageLimitations,
      ),
      outputTokens: evidenceMetric(
        aggregate(bundle, "outputTokens"),
        usageSource,
        aggregate(bundle, "outputTokens") === null ? 0 : 100,
        usageLimitations,
      ),
      cachedTokens: evidenceMetric(
        aggregate(bundle, "cachedTokens"),
        usageSource,
        aggregate(bundle, "cachedTokens") === null ? 0 : 100,
        usageLimitations,
      ),
      reasoningTokens: evidenceMetric(
        aggregate(bundle, "reasoningTokens"),
        usageSource,
        aggregate(bundle, "reasoningTokens") === null ? 0 : 100,
        usageLimitations,
      ),
      totalTokens: evidenceMetric(
        aggregate(bundle, "totalTokens"),
        usageSource,
        aggregate(bundle, "totalTokens") === null ? 0 : 100,
        usageLimitations,
      ),
      estimatedCostUsd: evidence(
        aggregate(bundle, "estimatedCostUsd"),
        costEvidenceMeasurement,
        costSource,
        aggregate(bundle, "estimatedCostUsd") === null ? 0 : costConfidence,
        costLimitations,
      ),
      measurement: usageMeasurement,
      costMeasurement,
    },
    git: {
      branchBefore: before?.branch ?? null,
      branchAfter: after?.branch ?? null,
      headBefore: before?.headSha ?? null,
      headAfter: after?.headSha ?? null,
      filesChanged: evidenceMetric(
        fileEvents.length,
        "Git boundary and timeline metadata",
        90,
      ),
      commitsCreated: evidenceMetric(commits.length, "Git history", 100),
      linesAdded: evidenceMetric(
        before && after
          ? Math.max(0, after.linesAdded - before.linesAdded)
          : null,
        "Git diff summary; supporting context only",
        80,
      ),
      linesDeleted: evidenceMetric(
        before && after
          ? Math.max(0, after.linesDeleted - before.linesDeleted)
          : null,
        "Git diff summary; supporting context only",
        80,
      ),
      uncommittedChanges: after?.uncommittedChanges ?? null,
    },
    score,
    analysis: latestAnalysis
      ? {
          provider: latestAnalysis.provider,
          model: latestAnalysis.model,
          generationId: latestAnalysis.generationId,
          evidenceHash: latestAnalysis.evidenceHash,
          schemaVersion: latestAnalysis.schemaVersion,
          usage: JSON.parse(latestAnalysis.usageJson),
          result: JSON.parse(latestAnalysis.analysisJson),
          createdAt: latestAnalysis.createdAt,
          authority:
            "narrative-only; deterministic evidence remains authoritative",
        }
      : null,
    privacy: {
      promptsStored: false,
      responsesStored: false,
      terminalOutputStored: false,
      sourceCodeStored: false,
      diffContentsStored: false,
    },
  };
}

export function renderReport(bundle: SessionBundle): string {
  const data = reportObject(bundle);
  const score = data.score;
  const validations = data.validation;
  const passed = validations.filter((item) => item.status === "passed").length;
  const taskOutcome = data.task.outcome as EvidenceValue<string>;
  const usage = data.usage;
  const benchmark = data.benchmark;
  const lines = [
    `TokenFaxx Session ${data.session.id}`,
    "",
    "Outcome",
    `  Process: ${data.process.status.value ?? unavailable} (exit ${data.process.exitCode.value ?? unavailable})`,
    `  Task: ${taskOutcome.value ?? "Unknown"}`,
    `  Acceptance: ${data.task.accepted === null ? unavailable : data.task.accepted ? "Accepted" : "Rejected"}`,
    `  Outcome confidence: ${score?.confidences?.outcome ?? taskOutcome.confidence}%`,
    ...(benchmark
      ? [
          "",
          "Benchmark",
          `  Verdict: ${benchmark.passed ? "PASS" : "FAIL"}`,
          `  Definition: sha256-v${benchmark.definitionHashVersion}:${benchmark.definitionHash}`,
          `  Starting commit: ${benchmark.resolvedStartingCommit}`,
          `  Setup: ${benchmark.setup.status}${benchmark.setup.status === "passed" ? ` (${duration(benchmark.setup.durationMs)})` : ""}`,
          ...benchmark.checks.map(
            (check) =>
              `  ${check.validationType}: expected ${check.expected ? "pass" : "fail"}, observed ${check.actual === null ? "missing" : check.actual ? "pass" : "fail"} — ${check.status}`,
          ),
        ]
      : []),
    "",
    "Validation",
    ...(validations.length
      ? validations.flatMap((item) => {
          const d = item.details;
          const stats =
            d.testsPassed != null
              ? ` — ${d.testsPassed} passed, ${d.testsFailed ?? 0} failed, ${d.testsSkipped ?? 0} skipped`
              : d.diagnostics != null
                ? ` — ${d.diagnostics} diagnostics${d.warnings != null ? `, ${d.warnings} warnings` : ""}`
                : "";
          return [
            `  ${item.type}: ${item.status}${stats} (${duration(item.durationMs)})`,
            ...d.limitations.map((limit: string) => `    Limitation: ${limit}`),
          ];
        })
      : ["  No validation commands were configured"]),
    `  Validation success: ${validations.length ? `${passed}/${validations.length}` : unavailable}`,
    "",
    "Usage",
    `  Input: ${fmt(usage.inputTokens.value)} tokens`,
    `  Cached input: ${fmt(usage.cachedTokens.value)} tokens`,
    `  Output: ${fmt(usage.outputTokens.value)} tokens`,
    `  Reasoning: ${fmt(usage.reasoningTokens.value)} tokens`,
    `  Total: ${fmt(usage.totalTokens.value)} tokens`,
    `  Cost: ${usage.estimatedCostUsd.value == null ? unavailable : `$${usage.estimatedCostUsd.value.toFixed(4)}`}`,
    `  Token source: ${usage.totalTokens.source}`,
    `  Cost source: ${usage.estimatedCostUsd.source}${usage.costMeasurement ? ` (${usage.costMeasurement})` : ""}`,
    "",
    "Change",
    `  Files associated with session: ${fmt(data.git.filesChanged.value)}`,
    `  Commits created: ${fmt(data.git.commitsCreated.value)}`,
    `  Added/deleted lines: ${fmt(data.git.linesAdded.value)}/${fmt(data.git.linesDeleted.value)} (supporting context only)`,
    `  Uncommitted changes: ${data.git.uncommittedChanges == null ? unavailable : data.git.uncommittedChanges ? "Yes" : "No"}`,
    "",
    "Rework",
    `  Estimated rate: ${score?.reworkRate == null ? "Insufficient data" : `${score.reworkRate}%`}`,
    ...(score?.reworkEvidence?.map((item: string) => `  - ${item}`) ?? []),
    "",
    "Attribution",
    `  Confidence: ${score?.confidences?.attribution ?? unavailable}${score ? "%" : ""}`,
    `  Classification: ${score?.attribution?.wording ?? unavailable}`,
    ...(score?.attribution?.missingEvidence?.map(
      (item: string) => `  Missing: ${item}`,
    ) ?? []),
    "",
    "Efficiency",
    `  Score: ${score?.finalScore == null ? "Insufficient data" : `${score.finalScore}/100`}`,
    `  Report confidence: ${score?.confidences?.overall ?? unavailable}${score ? "%" : ""}`,
  ];
  if (score)
    lines.push(
      ...score.components.map(
        (item) =>
          `  ${item.name}: ${item.normalized == null ? unavailable : `${item.normalized.toFixed(1)} × ${(item.weight * 100).toFixed(0)}% = ${item.contribution?.toFixed(1) ?? unavailable}`}`,
      ),
    );
  if (data.analysis)
    lines.push(
      "",
      `OpenRouter analysis (${data.analysis.model}; narrative only)`,
      `  ${data.analysis.result.summary}`,
      ...data.analysis.result.strengths.map((item) => `  Strength: ${item}`),
      ...data.analysis.result.concerns.map(
        (item: string) => `  Concern: ${item}`,
      ),
      ...data.analysis.result.anomalies.map(
        (item) =>
          `  Anomaly (${item.confidence}%): ${item.observation} [${item.evidenceEventIds.join(", ")}]`,
      ),
      ...data.analysis.result.missingEvidence.map(
        (item) => `  Missing: ${item}`,
      ),
      ...data.analysis.result.recommendations.map(
        (item: string) => `  Recommendation: ${item}`,
      ),
      `  ${data.analysis.result.disclaimer}`,
    );
  lines.push(
    "",
    "Privacy: no prompts, responses, terminal output, source code, or diff contents were stored.",
    "This evaluates the coding-agent session, not developer productivity.",
  );
  return lines.join("\n");
}

export function asCsv(objects: unknown[]): string {
  const rows = objects.map((input) => {
    const object = input as unknown as ReportData;
    return {
      sessionId: object.session.id,
      agent: object.session.agent,
      taskId: object.session.taskId,
      processStatus: object.process.status.value,
      taskOutcome: object.task.outcome.value,
      accepted: object.task.accepted,
      benchmarkPassed: object.benchmark?.passed ?? null,
      durationMs: object.process.durationMs.value,
      totalTokens: object.usage.totalTokens.value,
      estimatedCostUsd: object.usage.estimatedCostUsd.value,
      costMeasurement: object.usage.costMeasurement,
      validationPassed: object.validation.filter(
        (item) => item.status === "passed",
      ).length,
      validationTotal: object.validation.length,
      reworkRate: object.score?.reworkRate ?? null,
      efficiencyScore: object.score?.finalScore ?? null,
      reportConfidence: object.score?.confidences?.overall ?? null,
      attributionConfidence: object.score?.confidences?.attribution ?? null,
    };
  });
  const headers = Object.keys(rows[0] ?? { sessionId: "" });
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => csvEscape(row[header as keyof typeof row]))
        .join(","),
    ),
  ].join("\n");
}
