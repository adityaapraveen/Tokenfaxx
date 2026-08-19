#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import pino from "pino";
import { simpleGit } from "simple-git";
import {
  analyzeWithOpenRouter,
  inferTaskProfileWithOpenRouter,
} from "@tokenfaxx/analysis";
import { findAdapter, adapters } from "@tokenfaxx/adapters";
import {
  GitCollector,
  GitTimelineCollector,
  runValidation,
  type ValidationResult,
  type ValidationType,
} from "@tokenfaxx/collectors";
import {
  BENCHMARK_DEFINITION_HASH_VERSION,
  benchmarkDefinitionSchema,
  evaluateBenchmarkExpectations,
  EVENT_SCHEMA_VERSION,
  hashBenchmarkDefinition,
  taskProfileSchema,
  type BenchmarkDefinition,
  type BenchmarkVerdict,
  type TaskOutcomeStatus,
  type TokenFaxxConfig,
} from "@tokenfaxx/core";
import { evaluate } from "@tokenfaxx/scoring";
import { createId, nowIso } from "@tokenfaxx/shared";
import { TokenFaxxDatabase, type SessionBundle } from "@tokenfaxx/storage";
import { assessBenchmarkComparison, benchmarkExitCode } from "./benchmark.js";
import { databasePath, loadConfig } from "./config.js";
import { asCsv, renderReport, reportObject } from "./report.js";

const logger = pino({ level: process.env.TOKENFAXX_LOG_LEVEL ?? "warn" });
const program = new Command()
  .name("tokenfaxx")
  .description("Local-first observability and evaluation for coding agents")
  .version("0.1.0");
const root = (): string => path.resolve(process.cwd());
const openDb = (storageRoot = root()): TokenFaxxDatabase =>
  new TokenFaxxDatabase(databasePath(storageRoot));

function event(
  db: TokenFaxxDatabase,
  session: { id: string; agent: string; taskId: string | null },
  repository: string,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  db.appendEvent({
    id: createId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    sessionId: session.id,
    timestamp: nowIso(),
    agent: session.agent,
    repository,
    ...(session.taskId ? { taskId: session.taskId } : {}),
    eventType,
    payload,
    metadata: {},
  });
}

interface RunOptions {
  agent?: string;
  command?: string;
  taskId?: string;
  task?: string;
  passthroughArgs?: string[];
  repository?: string;
  storageRoot?: string;
  config?: TokenFaxxConfig;
  taskType?: string;
  complexity?: string;
  benchmarkId?: string;
  benchmark?: {
    definition: BenchmarkDefinition;
    definitionHash: string;
    resolvedStartingCommit: string;
  };
  maximumCostUsd?: number;
  aiProfile?: boolean;
}
function sanitizedEvidenceBundle(
  bundle: SessionBundle,
): Record<string, unknown> {
  const aliases = new Map<string, string>();
  const alias = (value: string): string => {
    if (!aliases.has(value)) aliases.set(value, `<file-${aliases.size + 1}>`);
    return aliases.get(value)!;
  };
  const sanitize = (value: unknown, key = ""): unknown => {
    if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([name]) =>
              ![
                "command",
                "evidence",
                "limitations",
                "message",
                "missingEvidence",
                "rationale",
                "reason",
                "repository",
                "repositoryPath",
                "source",
                "taskDescription",
                "statusJson",
              ].includes(name),
          )
          .map(([name, item]) => [name, sanitize(item, name)]),
      );
    if (
      typeof value === "string" &&
      (key === "path" || key.toLowerCase().includes("file"))
    )
      return alias(value);
    return value;
  };
  return sanitize(
    {
      session: {
        id: bundle.session.id,
        agent: bundle.session.agent,
        taskId: bundle.session.taskId,
        status: bundle.session.status,
        durationMs: bundle.session.durationMs,
        exitCode: bundle.session.childProcessExitCode,
      },
      events: bundle.events
        .filter((item) => item.eventType !== "analysis.completed")
        .map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          type: item.eventType,
          payload: item.payload,
        })),
      validations: bundle.validations.map((item) => ({
        id: item.id,
        type: item.validationType,
        status: item.status,
        durationMs: item.durationMs,
        details: (() => {
          const details = JSON.parse(item.detailsJson) as Record<
            string,
            unknown
          >;
          return {
            parser: details.parser,
            testFilesPassed: details.testFilesPassed,
            testFilesFailed: details.testFilesFailed,
            testsPassed: details.testsPassed,
            testsFailed: details.testsFailed,
            testsSkipped: details.testsSkipped,
            diagnostics: details.diagnostics,
            warnings: details.warnings,
            coveragePercent: details.coveragePercent,
          };
        })(),
      })),
      score: bundle.score
        ? {
            finalScore: bundle.score.finalScore,
            confidence: bundle.score.confidence,
            components: JSON.parse(bundle.score.components),
            details: JSON.parse(bundle.score.detailsJson),
          }
        : null,
    },
    "",
  ) as Record<string, unknown>;
}
async function attachOpenRouterAnalysis(
  db: TokenFaxxDatabase,
  bundle: SessionBundle,
  config: TokenFaxxConfig,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    throw new Error(
      "OPENROUTER_API_KEY is required when OpenRouter analysis is requested",
    );
  const result = await analyzeWithOpenRouter(sanitizedEvidenceBundle(bundle), {
    apiKey,
    model: config.analysis.model,
    timeoutMs: config.analysis.timeoutMs,
    maxCostUsd: config.analysis.maxCostUsd,
  });
  event(
    db,
    bundle.session,
    bundle.events[0]?.repository ?? root(),
    "analysis.completed",
    result as unknown as Record<string, unknown>,
  );
}
function recalculateScore(
  db: TokenFaxxDatabase,
  bundle: SessionBundle,
  config: TokenFaxxConfig,
): void {
  const profileEvent = bundle.events.find(
    (item) => item.eventType === "task.profiled",
  );
  const profile = profileEvent
    ? taskProfileSchema.parse(profileEvent.payload)
    : taskProfileSchema.parse({});
  const usages = bundle.usage;
  const completeTokens =
    usages.length > 0 && usages.every((item) => item.totalTokens != null);
  const completeCost =
    usages.length > 0 && usages.every((item) => item.estimatedCostUsd != null);
  const timeline = bundle.events
    .filter((item) => item.eventType === "git.sampled")
    .map((item) => ({
      timestamp: item.timestamp,
      changedFiles: item.payload.changedFiles as Awaited<
        ReturnType<GitCollector["sample"]>
      >["changedFiles"],
    }));
  const evaluation = evaluate(
    {
      outcome: (bundle.outcome?.status ?? "unknown") as TaskOutcomeStatus,
      taskId: bundle.session.taskId,
      commitCount: bundle.events.filter(
        (item) => item.eventType === "git.commit.created",
      ).length,
      filesChanged: bundle.events.filter(
        (item) => item.eventType === "file.changed",
      ).length,
      validations: bundle.validations.map((item) => ({
        type: item.validationType,
        status: item.status,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        details: JSON.parse(item.detailsJson),
      })),
      totalTokens: completeTokens
        ? usages.reduce((sum, item) => sum + item.totalTokens!, 0)
        : null,
      costUsd: completeCost
        ? usages.reduce((sum, item) => sum + item.estimatedCostUsd!, 0)
        : null,
      usageMeasurement: usages[0]?.measurementType ?? null,
      timeline,
      taskProfile: profile,
      ...(profile.maximumCostUsd !== undefined
        ? { maximumCostUsd: profile.maximumCostUsd }
        : {}),
      failedCommands: bundle.events.filter(
        (item) =>
          item.eventType === "command.completed" &&
          item.payload.status === "failed",
      ).length,
      commandCount: bundle.events.filter(
        (item) => item.eventType === "command.completed",
      ).length,
    },
    config,
  );
  db.saveScore(bundle.session.id, evaluation);
}
async function runTracked(options: RunOptions): Promise<{
  id: string;
  exitCode: number;
  benchmarkVerdict: BenchmarkVerdict | null;
}> {
  const repository = options.repository ?? root();
  const storageRoot = options.storageRoot ?? repository;
  const config = options.config ?? (await loadConfig(repository));
  if (options.aiProfile && !options.task)
    throw new Error("--ai-profile requires --task <description>");
  if (options.aiProfile && !process.env.OPENROUTER_API_KEY)
    throw new Error("--ai-profile requires OPENROUTER_API_KEY");
  const agentName = options.agent ?? (options.command ? "custom" : "");
  if (!agentName)
    throw new Error("Specify --agent <adapter> or --command <command>");
  const adapter = findAdapter(agentName);
  if (!adapter.detect())
    throw new Error(
      `${adapter.name} is not installed or not available on PATH`,
    );
  const launch = adapter.launch({
    ...(options.command ? { command: options.command } : {}),
    passthroughArgs: options.passthroughArgs ?? [],
  });
  const git = new GitCollector(repository);
  const repositoryInfo = await git.repositoryInfo();
  const before = await git.snapshot();
  const db = openDb(storageRoot);
  if (config.privacy.retentionDays)
    db.applyRetention(config.privacy.retentionDays);
  const session = db.createSession({
    repository,
    projectName: config.project.name ?? repositoryInfo.name,
    repositoryRemote: repositoryInfo.remote,
    agent: adapter.name,
    adapterVersion: adapter.version,
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.task ? { taskDescription: options.task } : {}),
  });
  db.addGitSnapshot(session.id, "before", before);
  event(db, session, repository, "session.started", {
    adapterVersion: adapter.version,
    branch: before.branch,
    headSha: before.headSha,
  });
  const benchmarkId = options.benchmark?.definition.id ?? options.benchmarkId;
  let taskProfile = taskProfileSchema.parse({
    benchmarkId,
    benchmarkDefinitionHashVersion: options.benchmark
      ? BENCHMARK_DEFINITION_HASH_VERSION
      : undefined,
    benchmarkDefinitionHash: options.benchmark?.definitionHash,
    benchmarkStartingCommit: options.benchmark?.resolvedStartingCommit,
    taskType: options.taskType ?? "other",
    validationCount: Object.values(config.validation).filter(
      (item) => item?.enabled,
    ).length,
    complexity: options.complexity ?? "unknown",
    complexitySource: options.complexity
      ? "user"
      : benchmarkId
        ? "benchmark"
        : "unknown",
    tags: options.benchmark?.definition.tags ?? [],
    maximumCostUsd: options.maximumCostUsd,
  });
  if (options.aiProfile) {
    process.stderr.write(
      "AI profiling: sending the task description to OpenRouter; no source code, diff, repository path, or environment values are sent.\n",
    );
    try {
      const inferred = await inferTaskProfileWithOpenRouter(options.task!, {
        apiKey: process.env.OPENROUTER_API_KEY!,
        model: config.analysis.model,
        timeoutMs: config.analysis.timeoutMs,
        maxCostUsd: config.analysis.maxCostUsd,
      });
      const reliable = inferred.profile.confidence >= 70;
      taskProfile = taskProfileSchema.parse({
        ...taskProfile,
        taskType:
          options.taskType ??
          (reliable ? inferred.profile.taskType : taskProfile.taskType),
        complexity:
          options.complexity ??
          (reliable ? inferred.profile.complexity : "unknown"),
        complexitySource: options.complexity
          ? "user"
          : reliable && inferred.profile.complexity !== "unknown"
            ? "llm-inferred"
            : "unknown",
        tags: inferred.profile.tags,
        confidence: inferred.profile.confidence,
        rationale: inferred.profile.rationale,
        missingEvidence: inferred.profile.missingEvidence,
        model: inferred.model,
        inference: {
          provider: inferred.provider,
          generationId: inferred.generationId,
          inputTokens: inferred.usage.inputTokens,
          outputTokens: inferred.usage.outputTokens,
          totalTokens: inferred.usage.totalTokens,
          costUsd: inferred.usage.costUsd,
        },
      });
      if (!reliable)
        process.stderr.write(
          `AI profile confidence was ${inferred.profile.confidence}%; complexity remains unknown and cannot affect token-efficiency scoring.\n`,
        );
    } catch (profileError) {
      process.stderr.write(
        `AI task profiling unavailable; using deterministic inputs: ${profileError instanceof Error ? profileError.message : String(profileError)}\n`,
      );
    }
  }
  event(db, session, repository, "task.profiled", taskProfile);
  const gitSamples: {
    timestamp: string;
    changedFiles: Awaited<ReturnType<GitCollector["sample"]>>["changedFiles"];
  }[] = [];
  const timeline = new GitTimelineCollector(
    git,
    config.collection.gitSampleIntervalMs,
    (sample) => {
      const timestamp = nowIso();
      gitSamples.push({ timestamp, changedFiles: sample.changedFiles });
      event(
        db,
        session,
        repository,
        "git.sampled",
        sample as unknown as Record<string, unknown>,
      );
    },
  );
  timeline.start();
  let timelineStopped = false;
  process.stdout.write(`TokenFaxx session ${session.id} started\n`);
  process.stdout.write(
    `Adapter metrics: exact tokens ${adapter.capabilities.supportsExactTokenUsage ? "supported" : "not reported"}; tool events ${adapter.capabilities.supportsToolEvents ? "supported" : "not reported"}\n`,
  );
  let interrupted = false;
  let childExit: number | null = null;
  const started = Date.now();
  try {
    childExit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: repository,
        stdio: "inherit",
        env: { ...process.env, ...launch.env },
        shell: adapter.name === "custom",
        detached: adapter.name === "custom" && process.platform !== "win32",
      });
      const forward = (signal: NodeJS.Signals): void => {
        interrupted = true;
        if (child.killed) return;
        try {
          // Shell commands can create grandchildren. A dedicated POSIX process
          // group lets shutdown reach the whole command tree without signaling TokenFaxx.
          if (adapter.name === "custom" && process.platform !== "win32")
            process.kill(-child.pid!, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      const onInt = (): void => forward("SIGINT");
      const onTerm = (): void => forward("SIGTERM");
      process.once("SIGINT", onInt);
      process.once("SIGTERM", onTerm);
      child.once("error", reject);
      child.once("close", (code) => {
        process.off("SIGINT", onInt);
        process.off("SIGTERM", onTerm);
        resolve(code);
      });
    });
    event(db, session, repository, "command.completed", {
      category: "agent",
      exitCode: childExit,
      durationMs: Date.now() - started,
      status: interrupted
        ? "interrupted"
        : childExit === 0
          ? "passed"
          : "failed",
      retryNumber: 0,
    });
    const validations: ValidationResult[] = [];
    if (!interrupted)
      for (const [type, definition] of Object.entries(config.validation) as [
        ValidationType,
        {
          command: string;
          timeoutMs: number;
          enabled: boolean;
          parser:
            | "auto"
            | "vitest"
            | "jest"
            | "junit"
            | "eslint"
            | "typescript"
            | "none";
          resultFile?: string;
        },
      ][]) {
        if (!definition?.enabled) continue;
        const result = await runValidation(
          type,
          definition.command,
          definition.timeoutMs,
          repository,
          {
            parser: definition.parser,
            ...(definition.resultFile
              ? { resultFile: definition.resultFile }
              : {}),
            maxOutputBytes: config.collection.maxValidationOutputBytes,
          },
        );
        validations.push(result);
        db.addValidation(session.id, result);
        event(db, session, repository, "validation.completed", {
          validationType: type,
          command: result.command,
          status: result.status,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          details: result.details,
        });
        event(db, session, repository, `${type}.completed`, {
          status: result.status,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      }
    await timeline.stop();
    timelineStopped = true;
    const after = await git.snapshot();
    db.addGitSnapshot(session.id, "after", after);
    const delta = await git.compare(before, after);
    for (const sha of delta.commits)
      event(db, session, repository, "git.commit.created", { sha });
    for (const file of delta.files)
      event(db, session, repository, "file.changed", file);
    const status = interrupted
      ? "interrupted"
      : childExit === 0
        ? "completed"
        : "failed";
    const outcome: TaskOutcomeStatus = interrupted
      ? "attempted"
      : childExit !== 0
        ? "failed"
        : validations.length === 0
          ? "completed-unverified"
          : validations.every((item) => item.status === "passed")
            ? "completed-validated"
            : "partially-completed";
    event(db, session, repository, "task.outcome", {
      status: outcome,
      accepted: null,
      reason: interrupted ? "Session interrupted" : undefined,
      evidence: [
        ...(delta.commits.length
          ? [`${delta.commits.length} commit(s) observed`]
          : []),
        ...validations.map((v) => `${v.type}: ${v.status}`),
      ],
    });
    event(db, session, repository, "session.completed", {
      status,
      exitCode: childExit,
      durationMs: Date.now() - started,
    });
    db.completeSession(session.id, status, childExit);
    const evaluation = evaluate(
      {
        outcome,
        taskId: session.taskId,
        commitCount: delta.commits.length,
        filesChanged: delta.filesChanged,
        validations,
        timeline: gitSamples,
        taskProfile,
        ...(options.maximumCostUsd !== undefined
          ? { maximumCostUsd: options.maximumCostUsd }
          : {}),
        failedCommands: childExit === 0 ? 0 : 1,
        commandCount: 1,
        filesCreatedThenDeleted: Math.min(
          delta.filesCreated,
          delta.filesDeleted,
        ),
      },
      config,
    );
    db.saveScore(session.id, evaluation);
    const benchmarkVerdict = options.benchmark
      ? evaluateBenchmarkExpectations(
          options.benchmark.definition,
          options.benchmark.definitionHash,
          options.benchmark.resolvedStartingCommit,
          validations,
        )
      : null;
    if (benchmarkVerdict)
      event(
        db,
        session,
        repository,
        "benchmark.evaluated",
        benchmarkVerdict as unknown as Record<string, unknown>,
      );
    let bundle = db.getBundle(session.id);
    if (bundle && config.analysis.enabled) {
      try {
        await attachOpenRouterAnalysis(db, bundle, config);
        bundle = db.getBundle(session.id);
      } catch (analysisError) {
        process.stderr.write(
          `OpenRouter analysis unavailable: ${analysisError instanceof Error ? analysisError.message : String(analysisError)}\n`,
        );
      }
    }
    if (bundle) process.stdout.write(`${renderReport(bundle)}\n`);
    db.close();
    return {
      id: session.id,
      exitCode: interrupted ? 130 : (childExit ?? 1),
      benchmarkVerdict,
    };
  } catch (error) {
    logger.error(
      { err: error, sessionId: session.id },
      "tracked process failed",
    );
    try {
      if (!timelineStopped) {
        await timeline.stop();
        timelineStopped = true;
      }
      event(db, session, repository, "error", {
        code: "PROCESS_FAILURE",
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      });
      event(db, session, repository, "session.completed", {
        status: "failed",
        exitCode: childExit,
        durationMs: Date.now() - started,
      });
      db.completeSession(session.id, "failed", childExit);
    } finally {
      db.close();
    }
    throw error;
  }
}

function validationSuggestions(directory: string): Record<string, string> {
  const filename = path.join(directory, "package.json");
  if (!fs.existsSync(filename)) return {};
  const pkg = JSON.parse(fs.readFileSync(filename, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const result: Record<string, string> = {};
  for (const key of ["test", "build", "lint", "typecheck"])
    if (pkg.scripts?.[key]) result[key] = `npm run ${key}`;
  return result;
}
program
  .command("init")
  .description("Initialize privacy-safe local configuration")
  .option("--yes", "accept detected validation commands")
  .action(async (options: { yes?: boolean }) => {
    const directory = root();
    const suggestions = validationSuggestions(directory);
    const configFile = path.join(directory, "tokenfaxx.config.ts");
    if (fs.existsSync(configFile))
      throw new Error("tokenfaxx.config.ts already exists");
    const validations = options.yes
      ? Object.entries(suggestions)
          .map(
            ([key, command]) =>
              `    ${key}: { command: ${JSON.stringify(command)}, timeoutMs: 120000, enabled: true }`,
          )
          .join(",\n")
      : "    // Add only commands you have reviewed and want TokenFaxx to execute.";
    fs.writeFileSync(
      configFile,
      `import { defineConfig } from "@tokenfaxx/core";\n\nexport default defineConfig({\n  project: { name: ${JSON.stringify(path.basename(directory))} },\n  validation: {\n${validations}\n  },\n  privacy: { storePrompts: false, storeResponses: false, storeTerminalOutput: false, storeDiffContents: false, retentionDays: 90 },\n  analysis: { enabled: false, provider: "openrouter", model: "openai/gpt-4o-mini", maxCostUsd: 0.05 }\n});\n`,
      { flag: "wx" },
    );
    const ignore = path.join(directory, ".gitignore");
    const current = fs.existsSync(ignore)
      ? fs.readFileSync(ignore, "utf8")
      : "";
    if (!current.split(/\r?\n/).includes(".tokenfaxx/"))
      fs.appendFileSync(
        ignore,
        `${current && !current.endsWith("\n") ? "\n" : ""}.tokenfaxx/\n`,
      );
    const db = openDb();
    db.close();
    process.stdout.write(
      `Initialized TokenFaxx. Detected validation scripts: ${Object.keys(suggestions).join(", ") || "none"}. ${options.yes ? "Saved reviewed suggestions." : "They were not enabled automatically."}\n`,
    );
  });

program
  .command("run")
  .description("Run a coding agent in a tracked session")
  .option("--agent <adapter>")
  .option("--command <command>")
  .option("--task-id <id>")
  .option("--task <description>")
  .option(
    "--task-type <type>",
    "bugfix, feature, refactor, migration, investigation, or other",
  )
  .option("--complexity <level>", "small, medium, large, or unknown")
  .option("--benchmark-id <id>")
  .option("--maximum-cost-usd <amount>")
  .option(
    "--ai-profile",
    "send the task description to OpenRouter for bounded task profiling",
  )
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(
    async (
      options: {
        agent?: string;
        command?: string;
        taskId?: string;
        task?: string;
        taskType?: string;
        complexity?: string;
        benchmarkId?: string;
        maximumCostUsd?: string;
        aiProfile?: boolean;
      },
      command,
    ) => {
      const { maximumCostUsd, ...runOptions } = options;
      const result = await runTracked({
        ...runOptions,
        ...(maximumCostUsd ? { maximumCostUsd: Number(maximumCostUsd) } : {}),
        passthroughArgs: command.args.slice(1),
      });
      process.exitCode = result.exitCode;
    },
  );

function outputBundle(bundle: SessionBundle, format: string): void {
  if (format === "json")
    process.stdout.write(`${JSON.stringify(reportObject(bundle), null, 2)}\n`);
  else if (format === "jsonl")
    process.stdout.write(`${JSON.stringify(reportObject(bundle))}\n`);
  else if (format === "csv")
    process.stdout.write(`${asCsv([reportObject(bundle)])}\n`);
  else process.stdout.write(`${renderReport(bundle)}\n`);
}
program
  .command("report")
  .option("--session <id>")
  .option("--format <format>", "terminal, json, jsonl, or csv", "terminal")
  .option("--no-color")
  .option("--analysis <mode>", "deterministic or openrouter", "deterministic")
  .option("--refresh-analysis", "request a new OpenRouter analysis")
  .action(
    async (options: {
      session?: string;
      format: string;
      analysis: string;
      refreshAnalysis?: boolean;
    }) => {
      const db = openDb();
      try {
        let bundle = db.getBundle(options.session);
        if (!bundle) throw new Error("No matching session found");
        if (
          options.analysis === "openrouter" &&
          (options.refreshAnalysis || bundle.analyses.length === 0)
        ) {
          const config = await loadConfig(root());
          await attachOpenRouterAnalysis(db, bundle, config);
          bundle = db.getBundle(bundle.session.id)!;
        }
        if (!bundle)
          throw new Error("Session disappeared while generating analysis");
        outputBundle(bundle, options.format);
      } finally {
        db.close();
      }
    },
  );
program
  .command("mark-outcome")
  .argument("<session-id>")
  .requiredOption(
    "--status <status>",
    "accepted, rejected, partially-completed, or another outcome state",
  )
  .option("--reason <reason>")
  .action(async (id: string, options: { status: string; reason?: string }) => {
    const allowed = new Set([
      "unknown",
      "attempted",
      "partially-completed",
      "completed-unverified",
      "completed-validated",
      "accepted",
      "rejected",
      "failed",
    ]);
    if (!allowed.has(options.status))
      throw new Error(`Invalid outcome status '${options.status}'`);
    const db = openDb();
    let bundle = db.getBundle(id);
    if (!bundle) throw new Error(`Session ${id} was not found`);
    event(
      db,
      bundle.session,
      bundle.events[0]?.repository ?? root(),
      "task.outcome",
      {
        status: options.status,
        accepted:
          options.status === "accepted"
            ? true
            : options.status === "rejected"
              ? false
              : null,
        reason: options.reason ?? "Explicitly supplied by the user",
        evidence: ["Explicit user outcome"],
      },
    );
    bundle = db.getBundle(id)!;
    recalculateScore(db, bundle, await loadConfig(root()));
    db.close();
    process.stdout.write(
      `Recorded explicit outcome '${options.status}' for ${id} and recalculated its score.\n`,
    );
  });
program
  .command("sessions")
  .option("--agent <agent>")
  .option("--task-id <id>")
  .option("--limit <number>", "maximum rows", "20")
  .action((options: { agent?: string; taskId?: string; limit: string }) => {
    const db = openDb();
    const sessions = db.listSessions({
      ...(options.agent ? { agent: options.agent } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
      limit: Number(options.limit),
    });
    for (const s of sessions)
      process.stdout.write(
        `${s.id}\t${s.startedAt}\t${s.agent}\t${s.taskId ?? "-"}\t${s.status}\n`,
      );
    db.close();
  });
program
  .command("compare")
  .argument("<session-a>")
  .argument("<session-b>")
  .action((a: string, b: string) => {
    const db = openDb();
    const left = db.getBundle(a);
    const right = db.getBundle(b);
    if (!left || !right) throw new Error("One or both sessions were not found");
    const profile = (bundle: SessionBundle) =>
      bundle.events.find((item) => item.eventType === "task.profiled")?.payload;
    const leftProfile = profile(left);
    const rightProfile = profile(right);
    const sameTask = Boolean(
      left.session.taskId && left.session.taskId === right.session.taskId,
    );
    const leftHead = left.gitSnapshots.find(
      (item) => item.snapshotType === "before",
    )?.headSha;
    const rightHead = right.gitSnapshots.find(
      (item) => item.snapshotType === "before",
    )?.headSha;
    const sameStart = Boolean(leftHead && leftHead === rightHead);
    const comparison = assessBenchmarkComparison(
      leftProfile,
      rightProfile,
      sameTask,
      sameStart,
    );
    const { comparisonConfidence } = comparison;
    if (comparisonConfidence < 65)
      process.stdout.write(
        "Warning: These sessions are not directly comparable; no winner will be declared.\n",
      );
    const value = (bundle: SessionBundle) => {
      const report = reportObject(bundle);
      return {
        session: bundle.session.id,
        agent: bundle.session.agent,
        taskId: bundle.session.taskId,
        status: bundle.session.status,
        durationMs: bundle.session.durationMs,
        usage: report.usage,
        validations: bundle.validations.map((v) => ({
          type: v.validationType,
          status: v.status,
        })),
        score: report.score,
      };
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const leftScore = (leftValue.score as { finalScore?: number | null } | null)
      ?.finalScore;
    const rightScore = (
      rightValue.score as { finalScore?: number | null } | null
    )?.finalScore;
    const winner =
      comparisonConfidence >= 65 && leftScore != null && rightScore != null
        ? leftScore === rightScore
          ? "tie"
          : leftScore > rightScore
            ? left.session.id
            : right.session.id
        : null;
    process.stdout.write(
      `${JSON.stringify({ comparisonConfidence, comparable: comparisonConfidence >= 65, basis: comparison.basis, winner, left: leftValue, right: rightValue }, null, 2)}\n`,
    );
    db.close();
  });
program
  .command("export")
  .option("--session <id>")
  .option("--format <format>", "json, jsonl, or csv", "json")
  .action((options: { session?: string; format: string }) => {
    const db = openDb();
    const bundles = options.session
      ? ([db.getBundle(options.session)].filter(Boolean) as SessionBundle[])
      : (db
          .listSessions({ limit: 10_000 })
          .map((s) => db.getBundle(s.id))
          .filter(Boolean) as SessionBundle[]);
    const objects = bundles.map(reportObject);
    if (options.format === "csv") process.stdout.write(`${asCsv(objects)}\n`);
    else if (options.format === "jsonl")
      process.stdout.write(
        `${objects.map((o) => JSON.stringify(o)).join("\n")}\n`,
      );
    else process.stdout.write(`${JSON.stringify(objects, null, 2)}\n`);
    db.close();
  });
program
  .command("delete-session")
  .argument("<session-id>")
  .action((id: string) => {
    const db = openDb();
    if (!db.deleteSession(id)) throw new Error(`Session ${id} was not found`);
    db.close();
    process.stdout.write(`Deleted session ${id}\n`);
  });
program
  .command("delete-all-data")
  .option("--yes", "confirm irreversible deletion")
  .action((options: { yes?: boolean }) => {
    if (!options.yes)
      throw new Error("Refusing to delete all data without --yes");
    const db = openDb();
    db.deleteAll();
    db.close();
    process.stdout.write("Deleted all TokenFaxx session data.\n");
  });

program
  .command("doctor")
  .description("Check the local TokenFaxx environment")
  .action(async () => {
    const directory = root();
    const checks: [boolean, string, string?][] = [];
    let loadedConfig: TokenFaxxConfig | null = null;
    const major = Number(process.versions.node.split(".")[0]);
    checks.push([
      major >= 20,
      `Node.js ${process.versions.node}`,
      "Install Node.js 20 or newer",
    ]);
    for (const executable of ["git", "pnpm"] as const) {
      const found =
        spawnSync(executable, ["--version"], { stdio: "ignore" }).status === 0;
      checks.push([
        found,
        `${executable} ${found ? "available" : "not found"}`,
        `Install ${executable} and add it to PATH`,
      ]);
    }
    checks.push([
      await new GitCollector(directory).isRepository(),
      "Current directory is a Git repository",
      "Run inside a Git repository",
    ]);
    try {
      loadedConfig = await loadConfig(directory);
      checks.push([true, "TokenFaxx configuration is valid"]);
    } catch (error) {
      checks.push([
        false,
        "TokenFaxx configuration is invalid",
        error instanceof Error ? error.message : String(error),
      ]);
    }
    try {
      const db = openDb();
      db.close();
      checks.push([true, "TokenFaxx database is accessible"]);
    } catch (error) {
      checks.push([
        false,
        "TokenFaxx database is inaccessible",
        error instanceof Error ? error.message : String(error),
      ]);
    }
    for (const adapter of adapters.filter((a) => a.name !== "sdk"))
      checks.push([
        adapter.detect(),
        `${adapter.name} adapter ${adapter.detect() ? "detected" : "executable not found"}`,
        `Install ${adapter.name} or choose another adapter`,
      ]);
    if (loadedConfig?.analysis.enabled)
      checks.push([
        Boolean(process.env.OPENROUTER_API_KEY),
        "OpenRouter analysis API key is configured",
        "Set OPENROUTER_API_KEY or disable analysis",
      ]);
    for (const [ok, message, fix] of checks)
      process.stdout.write(
        `${ok ? "✓" : "⚠"} ${message}${!ok && fix ? ` — ${fix}` : ""}\n`,
      );
    process.stdout.write(
      "Privacy: no telemetry; prompts, responses, terminal output, source, diffs, environment values, and secrets are not stored.\n",
    );
  });

const benchmark = program.command("benchmark");
benchmark
  .command("run")
  .requiredOption("--task <file>")
  .requiredOption("--agent <adapter>")
  .option("--command <command>")
  .action(
    async (options: { task: string; agent: string; command?: string }) => {
      const primary = root();
      const definition = benchmarkDefinitionSchema.parse(
        JSON.parse(fs.readFileSync(path.resolve(options.task), "utf8")),
      );
      const repository = path.resolve(primary, definition.repository);
      const git = simpleGit(repository);
      if (!(await git.status()).isClean())
        throw new Error(
          "Benchmark mode requires a clean repository; the primary working tree was not modified",
        );
      const worktree = fs.mkdtempSync(
        path.join(os.tmpdir(), `tokenfaxx-${definition.id}-`),
      );
      const resolvedStartingCommit = (
        await git.revparse([definition.startingCommit])
      ).trim();
      const definitionHash = hashBenchmarkDefinition(
        definition,
        resolvedStartingCommit,
      );
      let succeeded = false;
      try {
        await git.raw([
          "worktree",
          "add",
          "--detach",
          worktree,
          definition.startingCommit,
        ]);
        const base = await loadConfig(repository);
        const config: TokenFaxxConfig = {
          ...base,
          validation: Object.fromEntries(
            Object.entries(definition.validation).map(([type, command]) => [
              type,
              {
                command,
                timeoutMs: definition.timeoutMs,
                enabled: true,
                parser: "auto" as const,
              },
            ]),
          ),
        };
        const result = await runTracked({
          agent: options.agent,
          ...(options.command ? { command: options.command } : {}),
          taskId: definition.id,
          task: definition.description,
          repository: worktree,
          storageRoot: primary,
          config,
          benchmark: { definition, definitionHash, resolvedStartingCommit },
          ...(definition.maximumCostUsd !== undefined
            ? { maximumCostUsd: definition.maximumCostUsd }
            : {}),
        });
        if (!result.benchmarkVerdict)
          throw new Error("Benchmark completed without producing a verdict");
        const exitCode = benchmarkExitCode(
          result.exitCode,
          result.benchmarkVerdict,
        );
        succeeded = exitCode === 0;
        process.exitCode = exitCode;
        if (exitCode !== result.exitCode && exitCode !== 0)
          process.stderr.write(
            `Benchmark expectations were not met; exiting with ${exitCode}.\n`,
          );
      } finally {
        if (succeeded) {
          await git.raw(["worktree", "remove", "--force", worktree]);
        } else
          process.stderr.write(
            `Benchmark worktree preserved for debugging: ${worktree}\n`,
          );
      }
    },
  );
benchmark
  .command("compare")
  .requiredOption("--benchmark <id>")
  .action((options: { benchmark: string }) => {
    const db = openDb();
    const matches = db
      .listSessions({ taskId: options.benchmark, limit: 100 })
      .map((s) => db.getBundle(s.id))
      .filter(Boolean) as SessionBundle[];
    process.stdout.write(
      `${JSON.stringify(matches.map(reportObject), null, 2)}\n`,
    );
    db.close();
  });

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  program.parseAsync().catch((error: unknown) => {
    process.stderr.write(
      `TokenFaxx error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export { runTracked, sanitizedEvidenceBundle };
