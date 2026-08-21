import type {
  TaskOutcomeStatus,
  TaskProfile,
  TokenFaxxConfig,
} from "@tokenfaxx/core";
import { clamp } from "@tokenfaxx/shared";

export interface EvaluationInput {
  outcome: TaskOutcomeStatus;
  taskId?: string | null;
  commitCount: number;
  filesChanged: number;
  validations: {
    status: string;
    type: string;
    startedAt?: string;
    completedAt?: string;
    details?: {
      testsPassed?: number | null;
      testsFailed?: number | null;
      diagnostics?: number | null;
    };
  }[];
  totalTokens?: number | null;
  costUsd?: number | null;
  usageMeasurement?: string | null;
  failedCommands?: number;
  commandCount?: number;
  timeline?: {
    timestamp: string;
    changedFiles: {
      path: string;
      index: string;
      workingTree: string;
      size: number | null;
      modifiedAtMs: number | null;
    }[];
  }[];
  filesCreatedThenDeleted?: number;
  taskProfile?: TaskProfile;
  maximumCostUsd?: number;
}
export interface Attribution {
  score: number;
  level: "low" | "medium" | "high";
  explicit: boolean;
  reasons: string[];
  missingEvidence: string[];
  wording: string;
}
export interface ReportConfidences {
  dataCompleteness: number;
  attribution: number;
  outcome: number;
  usageAccuracy: number | null;
  comparison: number | null;
  overall: number;
}
export interface ScoreComponent {
  name: string;
  weight: number;
  rawInput: unknown;
  normalized: number | null;
  contribution: number | null;
  missing: boolean;
  explanation: string;
}
export interface Evaluation {
  finalScore: number | null;
  confidence: number;
  confidenceLevel: "Low" | "Medium" | "High";
  confidences: ReportConfidences;
  insufficientData: boolean;
  attribution: Attribution;
  reworkRate: number | null;
  reworkEvidence: string[];
  components: ScoreComponent[];
  explanation: string[];
}

function timelineRework(input: EvaluationInput): {
  rate: number | null;
  evidence: string[];
} {
  if (input.filesChanged === 0)
    return {
      rate: null,
      evidence: [
        "Not applicable because no file changes were attributed to the session",
      ],
    };
  if (!input.timeline || input.timeline.length < 2)
    return {
      rate: null,
      evidence: ["Periodic Git timeline evidence was unavailable"],
    };
  const transitions = new Map<string, number>();
  let previous = new Map<string, string>();
  let createdThenDeleted = 0;
  for (const sample of input.timeline) {
    const current = new Map(
      sample.changedFiles.map((file) => [
        file.path,
        `${file.index}:${file.workingTree}:${file.size ?? "?"}:${file.modifiedAtMs ?? "?"}`,
      ]),
    );
    for (const [path, signature] of current)
      if (previous.get(path) !== signature)
        transitions.set(path, (transitions.get(path) ?? 0) + 1);
    for (const path of previous.keys())
      if (
        !current.has(path) &&
        (previous.get(path)?.includes("A") ||
          previous.get(path)?.startsWith("?:?"))
      )
        createdThenDeleted++;
    previous = current;
  }
  const repeated = [...transitions.values()].filter((count) => count > 1);
  const extraEdits = repeated.reduce((sum, count) => sum + count - 1, 0);
  const failedValidations = input.validations.filter(
    (item) => item.status === "failed",
  ).length;
  const denominator = Math.max(1, transitions.size + input.validations.length);
  const rate = clamp(
    ((extraEdits + createdThenDeleted + failedValidations) / denominator) * 100,
  );
  const evidence: string[] = [];
  if (repeated.length)
    evidence.push(
      `${repeated.length} file(s) changed in multiple observed intervals`,
    );
  if (failedValidations)
    evidence.push(
      `${failedValidations} validation failure(s) preceded the final state`,
    );
  if (createdThenDeleted)
    evidence.push(
      `${createdThenDeleted} newly observed file(s) disappeared before completion`,
    );
  if (!evidence.length)
    evidence.push("No rework signals were observed in the metadata timeline");
  return { rate: Math.round(rate * 10) / 10, evidence };
}
const outcomeValue: Record<TaskOutcomeStatus, number | null> = {
  unknown: null,
  attempted: 20,
  "partially-completed": 50,
  "completed-unverified": 70,
  "completed-validated": 90,
  accepted: 100,
  rejected: 10,
  failed: 0,
};
const outcomeConfidence: Record<TaskOutcomeStatus, number> = {
  unknown: 10,
  attempted: 35,
  "partially-completed": 55,
  "completed-unverified": 55,
  "completed-validated": 85,
  accepted: 100,
  rejected: 100,
  failed: 90,
};

export function evaluate(
  input: EvaluationInput,
  config: TokenFaxxConfig,
): Evaluation {
  const reasons: string[] = [];
  const missing: string[] = [];
  let attributionScore = 5;
  if (input.taskId) {
    attributionScore += 25;
    reasons.push(
      "A task ID explicitly links the session to the requested work",
    );
  }
  if (input.taskProfile?.benchmarkId) {
    attributionScore += 20;
    reasons.push("A benchmark ID and controlled task profile were supplied");
  }
  if (input.commitCount > 0) {
    attributionScore += 30;
    reasons.push("Commit(s) appeared between the session Git boundaries");
  } else missing.push("No commit was created during the tracked session");
  if (input.filesChanged > 0) {
    attributionScore += 15;
    reasons.push(
      "Git timeline metadata observed file changes during the session",
    );
  }
  if (input.validations.some((item) => item.status === "passed")) {
    attributionScore += 10;
    reasons.push("Validation ran against the resulting working tree");
  } else missing.push("No passing validation evidence is available");
  missing.push("No pull-request review or merge result is available locally");
  attributionScore = clamp(attributionScore);
  const attribution: Attribution = {
    score: attributionScore,
    level:
      attributionScore >= 75
        ? "high"
        : attributionScore >= 45
          ? "medium"
          : "low",
    explicit: Boolean(input.taskId || input.taskProfile?.benchmarkId),
    reasons,
    missingEvidence: missing,
    wording:
      attributionScore >= 75
        ? "Likely associated with this session"
        : attributionScore >= 45
          ? "Estimated association"
          : "Insufficient attribution evidence",
  };
  const rework = timelineRework(input);
  const outcomeNorm = outcomeValue[input.outcome];
  const completedValidations = input.validations.filter(
    (item) => item.status !== "skipped",
  );
  const qualityNorm = completedValidations.length
    ? (completedValidations.filter((item) => item.status === "passed").length /
        completedValidations.length) *
      100
    : null;
  const baselines: Record<
    NonNullable<TaskProfile["complexity"]>,
    number | null
  > = { small: 15_000, medium: 40_000, large: 100_000, unknown: null };
  const tokenBaseline = baselines[input.taskProfile?.complexity ?? "unknown"];
  const tokenNorm =
    input.totalTokens == null ||
    tokenBaseline == null ||
    input.usageMeasurement === "estimated" ||
    (outcomeNorm ?? 0) < 70
      ? null
      : clamp(100 - Math.max(0, input.totalTokens / tokenBaseline - 1) * 35);
  const costNorm =
    input.costUsd == null ||
    input.maximumCostUsd == null ||
    input.usageMeasurement === "estimated" ||
    (outcomeNorm ?? 0) < 70
      ? null
      : clamp(
          100 - Math.max(0, input.costUsd / input.maximumCostUsd - 0.5) * 100,
        );
  const values: Record<
    string,
    { normalized: number | null; raw: unknown; explanation: string }
  > = {
    outcome: {
      normalized: outcomeNorm,
      raw: input.outcome,
      explanation:
        "Outcome is separated from process exit and weighted by verification strength.",
    },
    validationQuality: {
      normalized: qualityNorm,
      raw: input.validations,
      explanation:
        "Percentage of explicitly configured validations that passed.",
    },
    tokenEfficiency: {
      normalized: tokenNorm,
      raw: input.totalTokens ?? "unavailable",
      explanation:
        tokenNorm === null
          ? "Requires reported usage, successful outcome, and an explicit task-complexity baseline."
          : `Compared with the ${input.taskProfile?.complexity} task baseline.`,
    },
    costEfficiency: {
      normalized: costNorm,
      raw: input.costUsd ?? "unavailable",
      explanation:
        costNorm === null
          ? "Requires reported cost, successful outcome, and a configured maximum cost."
          : "Compared with the task's configured maximum cost.",
    },
    rework: {
      normalized: rework.rate === null ? null : 100 - rework.rate,
      raw:
        rework.rate === null
          ? "insufficient timeline data"
          : `${rework.rate}% estimated`,
      explanation:
        "Metadata-only estimate from file-state transitions and validation failures.",
    },
    attributionConfidence: {
      normalized: attributionScore,
      raw: attribution.reasons,
      explanation:
        "Evidence associating observed changes and validations with this session.",
    },
  };
  const components = Object.entries(config.scoring.weights).map(
    ([name, weight]) => {
      const item = values[name]!;
      return {
        name,
        weight,
        rawInput: item.raw,
        normalized: item.normalized,
        contribution:
          item.normalized === null ? null : item.normalized * weight,
        missing: item.normalized === null,
        explanation: item.explanation,
      };
    },
  );
  const availableWeight = components
    .filter((item) => item.normalized !== null)
    .reduce((sum, item) => sum + item.weight, 0);
  const contribution = components.reduce(
    (sum, item) => sum + (item.contribution ?? 0),
    0,
  );
  const completenessSignals = [
    input.outcome !== "unknown",
    completedValidations.length > 0,
    input.timeline && input.timeline.length > 1,
    input.totalTokens != null,
    input.costUsd != null,
    input.taskProfile?.complexity !== "unknown",
    input.commitCount > 0 || input.filesChanged > 0,
  ];
  const dataCompleteness = Math.round(
    (completenessSignals.filter(Boolean).length / completenessSignals.length) *
      100,
  );
  const usageAccuracy =
    input.totalTokens == null
      ? null
      : input.usageMeasurement === "exact" ||
          input.usageMeasurement === "reported" ||
          input.usageMeasurement === "provider-reported"
        ? 100
        : input.usageMeasurement === "calculated"
          ? 85
          : 55;
  const outConfidence = outcomeConfidence[input.outcome];
  const overall = Math.round(
    dataCompleteness * 0.3 +
      attributionScore * 0.25 +
      outConfidence * 0.35 +
      (usageAccuracy ?? 50) * 0.1,
  );
  const confidences: ReportConfidences = {
    dataCompleteness,
    attribution: attributionScore,
    outcome: outConfidence,
    usageAccuracy,
    comparison: null,
    overall,
  };
  const essential =
    outConfidence >= 50 &&
    outcomeNorm !== null &&
    (qualityNorm !== null ||
      input.outcome === "accepted" ||
      input.outcome === "rejected") &&
    availableWeight >= 0.5;
  const finalScore = essential
    ? Math.round((contribution / availableWeight) * 10) / 10
    : null;
  return {
    finalScore,
    confidence: overall,
    confidenceLevel: overall >= 75 ? "High" : overall >= 45 ? "Medium" : "Low",
    confidences,
    insufficientData: finalScore === null,
    attribution,
    reworkRate: rework.rate,
    reworkEvidence: rework.evidence,
    components,
    explanation:
      finalScore === null
        ? [
            "A score was withheld because outcome or validation evidence is insufficient.",
          ]
        : [
            "This evaluates a coding-agent session, not developer productivity.",
            "Missing inputs are excluded and are never converted to zero.",
          ],
  };
}
