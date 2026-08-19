# TokenFaxx

TokenFaxx is a local-first CLI and TypeScript SDK for observing and evaluating coding-agent sessions. It connects process lifecycle, Git activity, validation results, token/cost data, task outcomes, and confidence into an explainable report.

TokenFaxx evaluates a session—not a developer. Token counts and lines changed are context, never standalone productivity measures.

> Project status: alpha (`0.1.0`). The local CLI/SDK vertical slice works, but hosted collaboration, provider-grade CLI usage capture, CI/PR enrichment, and production release automation are not complete. See [the product audit and roadmap](docs/PRODUCT_AUDIT.md).

## What works today

- Local SQLite storage with foreign keys, WAL mode, transactional/idempotent event projection, retention, exports, and deletion commands.
- Codex, Claude, generic shell-command, and instrumented SDK adapters.
- Before/after Git snapshots plus a metadata-only file activity timeline.
- Opt-in test, build, lint, and typecheck validation with bounded live output.
- Deterministic, confidence-aware scoring that withholds a score when evidence is insufficient.
- JSON, JSONL, CSV, terminal reports, session comparison, and reproducible benchmark worktrees with enforced expectations.
- Optional OpenRouter narrative analysis over sanitized metadata.
- Optional AI task profiling with a confidence threshold and deterministic fallback.
- Privacy-safe defaults: no telemetry and no stored prompts, responses, terminal output, source, diffs, environment values, or API keys.

## Requirements

- Node.js 20 or newer
- pnpm 9.15.9 (the version pinned in `package.json`)
- Git
- Native build tooling supported by `better-sqlite3` if a prebuilt binary is unavailable
- Optional: Codex or Claude CLI
- Optional: an OpenRouter account, credits, and API key for AI features

## Install for development

```bash
git clone <your-repository-url>
cd TokenFaxx
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm --filter tokenfaxx link --global
tokenfaxx --version
```

If `pnpm` is already installed at the required version, skip the two Corepack commands. The global link is for local development; publishing the CLI to npm is a future release task.

## Start tracking a repository

Run these commands inside the Git repository you want to measure:

```bash
tokenfaxx init
```

This creates `tokenfaxx.config.ts`, `.tokenfaxx/tokenfaxx.db`, and a `.gitignore` entry. By default, detected validation scripts are suggested but not enabled. Review commands before enabling them because they run with your user permissions.

For a trusted project, `tokenfaxx init --yes` enables detected `test`, `build`, `lint`, and `typecheck` package scripts.

Example configuration:

```ts
import { defineConfig } from "@tokenfaxx/core";

export default defineConfig({
  project: { name: "my-project" },
  validation: {
    test: {
      command:
        "pnpm test -- --reporter=json --outputFile=.tokenfaxx/vitest.json",
      parser: "vitest",
      resultFile: ".tokenfaxx/vitest.json",
      timeoutMs: 120_000,
      enabled: true,
    },
    typecheck: {
      command: "pnpm typecheck",
      parser: "typescript",
      timeoutMs: 120_000,
      enabled: true,
    },
  },
  privacy: {
    storePrompts: false,
    storeResponses: false,
    storeTerminalOutput: false,
    storeDiffContents: false,
    retentionDays: 90,
  },
  analysis: {
    enabled: false,
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    timeoutMs: 30_000,
    maxCostUsd: 0.05,
  },
  pricing: {
    custom: [
      {
        provider: "openai",
        model: "provider-returned-model-id",
        inputPerMillionUsd: 1.25,
        cachedInputPerMillionUsd: 0.125,
        outputPerMillionUsd: 10,
        effectiveDate: "2026-08-01",
        source: "approved provider pricing",
      },
    ],
  },
});
```

Run an agent:

```bash
tokenfaxx run \
  --agent codex \
  --task-id ENG-142 \
  --task "Fix notification migration" \
  --task-type bugfix \
  --complexity medium \
  --maximum-cost-usd 5
```

Use `--agent claude`, or run any reviewed command:

```bash
tokenfaxx run --command "node my-agent.js" --task "Implement the cache fix"
```

Interactive input, output, color, and signals are preserved. Raw terminal output is forwarded and discarded, not stored.

## AI features

AI is an interpretation layer, not the source of truth. Validation, Git, provider usage, and explicit human outcomes remain authoritative.

Set the API key in the environment; never put it in configuration:

```bash
export OPENROUTER_API_KEY="..."
```

### AI task profiling

When you do not know the task type or complexity, opt in per run:

```bash
tokenfaxx run \
  --agent codex \
  --task "Fix intermittent cache invalidation after a tenant rename" \
  --ai-profile
```

This sends only the task description to OpenRouter. It does not send source, diffs, repository paths, terminal output, or environment values. User-supplied `--task-type` and `--complexity` always win. An AI complexity classification affects token-efficiency scoring only at confidence 70 or higher; otherwise complexity remains `unknown`. Model, rationale, confidence, missing evidence, usage, and cost are retained with the task profile.

### Narrative report analysis

Enable automatic post-run analysis in configuration, or request it for one report:

```bash
tokenfaxx report --analysis openrouter
tokenfaxx report --analysis openrouter --refresh-analysis
```

The report analyzer receives sanitized, bounded metadata. Free-form commands, errors, reasons, paths, task descriptions, source, and diffs are excluded. Structured output is schema-validated, and anomaly citations are rejected unless they reference real transmitted evidence IDs.

The configured `maxCostUsd` is checked against reported cost after a response. It detects an overrun but cannot prevent already-billed provider usage; use a low-output model and provider-side limits for a hard budget.

See [OpenRouter analysis](docs/OPENROUTER_ANALYSIS.md) and [privacy](docs/PRIVACY.md).

## Commands

```text
tokenfaxx init [--yes]
tokenfaxx run (--agent codex|claude | --command "...") [task options]
tokenfaxx sessions [--agent NAME] [--task-id ID] [--limit 20]
tokenfaxx report [--session ID] [--format terminal|json|jsonl|csv]
tokenfaxx report --analysis openrouter [--refresh-analysis]
tokenfaxx mark-outcome SESSION_ID --status accepted|rejected|...
tokenfaxx compare SESSION_A SESSION_B
tokenfaxx export [--session ID] [--format json|jsonl|csv]
tokenfaxx delete-session SESSION_ID
tokenfaxx delete-all-data --yes
tokenfaxx doctor
tokenfaxx benchmark run --task benchmark.json --agent codex
tokenfaxx benchmark compare --benchmark BENCHMARK_ID
```

A zero process exit means the agent command exited successfully. It does not prove task completion. Without passing configured validation, TokenFaxx records `completed-unverified`. Record the eventual human/PR result explicitly:

```bash
tokenfaxx mark-outcome <session-id> \
  --status accepted \
  --reason "PR merged after review"
```

## Architecture and request lifecycle

```text
CLI / instrumented SDK
        |
        v
adapter launch -> process + signal lifecycle
        |
        +-> Git boundary/timeline collectors
        +-> configured validation collectors
        +-> provider usage reported through SDK
        |
        v
versioned events -> SQLite normalized records
        |
        v
deterministic scoring -> report/export/compare
        |
        +-> optional sanitized OpenRouter narrative
```

Package responsibilities:

| Package               | Responsibility                                                  |
| --------------------- | --------------------------------------------------------------- |
| `apps/cli`            | Orchestration, commands, reports, benchmark worktrees           |
| `packages/core`       | Configuration, event schemas, evidence types, pricing contracts |
| `packages/storage`    | SQLite schema, migration bootstrap, queries, retention          |
| `packages/collectors` | Git metadata and validation execution/parsing                   |
| `packages/adapters`   | Agent discovery and launch specifications                       |
| `packages/scoring`    | Deterministic normalization, confidence, attribution, rework    |
| `packages/analysis`   | Bounded OpenRouter structured-output features                   |
| `packages/sdk`        | Public in-process instrumentation API                           |
| `packages/shared`     | IDs, timestamps, redaction, CSV primitives                      |

## SDK instrumentation

CLI wrappers cannot reliably derive exact usage from decorative terminal output. For accurate tokens, models, cost, and tool events, record official provider response fields through the SDK:

```ts
import { defineConfig } from "@tokenfaxx/core";
import { TokenFaxx } from "@tokenfaxx/sdk";

const tracker = new TokenFaxx({
  agent: "custom-agent",
  repository: process.cwd(),
  config: defineConfig({
    pricing: {
      custom: [
        {
          provider: "openai",
          model: "provider-returned-model-id",
          inputPerMillionUsd: 1.25,
          cachedInputPerMillionUsd: 0.125,
          outputPerMillionUsd: 10,
          effectiveDate: "2026-08-01",
          source: "approved provider pricing",
        },
      ],
    },
  }),
});

const session = await tracker.startSession({
  taskId: "ENG-142",
  taskDescription: "Fix notification migration",
  taskProfile: {
    taskType: "bugfix",
    complexity: "medium",
    complexitySource: "user",
  },
});

await session.recordModelUsage({
  provider: "openai",
  model: "provider-returned-model-id",
  inputTokens: 8_200,
  outputTokens: 2_100,
  cachedInputTokens: 4_000,
  measurement: "reported",
  source: "official provider response",
});

await session.recordToolCall({
  tool: "terminal",
  actionType: "test",
  success: true,
  durationMs: 4_200,
});

await session.complete({
  status: "completed",
  exitCode: 0,
  taskOutcome: "completed-validated",
});

tracker.close();
```

Do not estimate unavailable provider fields. Preserve `null` so reports remain honest.

If `estimatedCostUsd` is absent and provider, model, input tokens, and output tokens exactly match one configured price, the SDK calculates cost. It stores cost provenance and the pricing effective date separately from token provenance. A caller-supplied cost is never overwritten. When supplying an official provider cost, label it explicitly:

```ts
await session.recordModelUsage({
  provider: "openai",
  model: "provider-returned-model-id",
  inputTokens: 8_200,
  outputTokens: 2_100,
  estimatedCostUsd: 0.42,
  costMeasurement: "provider-reported",
  costSource: "official provider response",
  measurement: "reported",
});
```

## Scoring and accuracy

Default weights are outcome 30%, validation quality 25%, token efficiency 15%, cost efficiency 10%, rework 10%, and attribution confidence 10%.

- Missing values are excluded, never treated as zero.
- Efficiency is withheld for unsuccessful tasks.
- Token efficiency requires task complexity plus reported usage.
- Cost efficiency requires reported/calculated cost plus a task budget.
- Rework is only a metadata-based estimate.
- Attribution states association, not causation.
- Comparisons warn when tasks or starting commits differ.

Read [the scoring methodology](docs/SCORING.md) before using the number in decisions.

## Benchmarks

Benchmark mode requires a clean primary repository. It creates a detached temporary Git worktree at the configured starting commit and never resets the primary tree. Successful worktrees are removed; failed worktrees are preserved and printed for debugging.

```bash
tokenfaxx benchmark run --task examples/benchmark.json --agent codex
tokenfaxx benchmark compare --benchmark fix-notification-migration
```

Each benchmark must declare at least one `expectedOutcome`, and every validation command must have exactly one matching expectation. TokenFaxx compares every expectation with the validation evidence, stores a `benchmark.evaluated` event, and prints the versioned definition SHA-256 plus the resolved starting commit. Benchmark validation commands come only from the hashed definition, so local configuration cannot silently change the gate. An expected check that produced no evidence is reported as `missing`, never guessed.

Exit codes are automation-safe:

- `0`: the agent command and all benchmark expectations passed.
- `2`: the agent command completed, but at least one expectation was unmet or missing.
- `130`: the run was interrupted.
- Another non-zero value: the tracked agent command failed while the declared expectations otherwise matched.

Review benchmark validation and agent commands before running them because they execute with your user permissions. See [benchmark evaluation](docs/BENCHMARKS.md) for the schema, verdict rules, CI usage, and a local smoke test.

## Development

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Useful documents:

- [Product audit and roadmap](docs/PRODUCT_AUDIT.md)
- [Adapter development](docs/ADAPTERS.md)
- [Event schema](docs/EVENT_SCHEMA.md)
- [Scoring methodology](docs/SCORING.md)
- [Benchmark evaluation](docs/BENCHMARKS.md)
- [Privacy and security](docs/PRIVACY.md)
- [OpenRouter analysis](docs/OPENROUTER_ANALYSIS.md)

## Troubleshooting

- Run `tokenfaxx doctor` in the tracked Git repository.
- If `pnpm` is not found, run `corepack enable && corepack prepare pnpm@9.15.9 --activate`.
- If configuration import fails, verify `tokenfaxx.config.ts` exports a `defineConfig(...)` result or plain compatible object.
- If SQLite installation fails, install a supported compiler toolchain and Python, then reinstall dependencies.
- If usage is unavailable, use SDK instrumentation. Codex/Claude terminal adapters intentionally do not scrape unstable UI output.
- If AI analysis fails, verify the API key, credits, model structured-output support, timeout, and outbound network access.
- If a session was interrupted, it should be finalized as interrupted when the child responds to the forwarded signal; inspect `tokenfaxx sessions` and the local database if the host was force-killed.

## License and releases

No license has been added yet, so the repository is not ready for open-source redistribution. Choose a license, add release automation, and publish packages only after the P0 release gates in the [product audit](docs/PRODUCT_AUDIT.md) are complete.
