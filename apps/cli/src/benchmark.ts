import { spawnSync } from "node:child_process";
import type {
  BenchmarkSetupObservation,
  BenchmarkVerdict,
} from "@tokenfaxx/core";

export const BENCHMARK_EXPECTATION_FAILED_EXIT_CODE = 2;

export interface BenchmarkComparisonAssessment {
  comparisonConfidence: number;
  basis: {
    sameBenchmarkId: boolean;
    sameBenchmarkDefinition: boolean;
    sameTask: boolean;
    sameStartingCommit: boolean;
  };
}

export function runBenchmarkSetup(
  command: string | undefined,
  cwd: string,
  timeoutMs: number,
): BenchmarkSetupObservation {
  if (!command) return { status: "not-configured", durationMs: 0 };
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  const durationMs = Date.now() - startedAt;
  if (result.error)
    throw new Error(`Benchmark setup could not run: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `Benchmark setup failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? "unknown"}`}`,
    );
  return { status: "passed", durationMs };
}

export function benchmarkExitCode(
  trackedProcessExitCode: number,
  verdict: BenchmarkVerdict,
): number {
  if (trackedProcessExitCode === 130) return 130;
  if (!verdict.passed) return BENCHMARK_EXPECTATION_FAILED_EXIT_CODE;
  return trackedProcessExitCode;
}

export function assessBenchmarkComparison(
  leftProfile: Record<string, unknown> | undefined,
  rightProfile: Record<string, unknown> | undefined,
  sameTask: boolean,
  sameStartingCommit: boolean,
): BenchmarkComparisonAssessment {
  const leftBenchmarkId =
    typeof leftProfile?.benchmarkId === "string"
      ? leftProfile.benchmarkId
      : null;
  const rightBenchmarkId =
    typeof rightProfile?.benchmarkId === "string"
      ? rightProfile.benchmarkId
      : null;
  const leftHash =
    typeof leftProfile?.benchmarkDefinitionHash === "string"
      ? leftProfile.benchmarkDefinitionHash
      : null;
  const rightHash =
    typeof rightProfile?.benchmarkDefinitionHash === "string"
      ? rightProfile.benchmarkDefinitionHash
      : null;
  const sameBenchmarkId = Boolean(
    leftBenchmarkId && leftBenchmarkId === rightBenchmarkId,
  );
  const sameBenchmarkDefinition = Boolean(
    sameBenchmarkId && leftHash && leftHash === rightHash,
  );
  const benchmarkComparison = Boolean(leftBenchmarkId || rightBenchmarkId);
  const comparisonConfidence =
    sameBenchmarkDefinition && sameStartingCommit
      ? 100
      : benchmarkComparison
        ? 40
        : sameTask && sameStartingCommit
          ? 85
          : sameTask
            ? 65
            : 20;
  return {
    comparisonConfidence,
    basis: {
      sameBenchmarkId,
      sameBenchmarkDefinition,
      sameTask,
      sameStartingCommit,
    },
  };
}
