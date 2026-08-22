# TokenFaxx: complete project and interview guide

Last verified against the codebase: 2026-08-20  
Project version: `0.1.0` alpha  
Audience: project author, contributors, technical interviewers, and evaluators

This is the code-level guide to TokenFaxx. It explains what the product is, why it exists, how data moves through it, how each package works, what every command does, where AI helps, where AI is deliberately not trusted, how to demo it, and what remains before it is a production team product.

The most important rule when presenting TokenFaxx is this:

> Describe the evidence the system has, the confidence it assigns, and the evidence it is missing. Never claim that TokenFaxx knows more than it observes.

## 1. The shortest useful explanation

### One sentence

TokenFaxx is a local-first observability and evaluation layer for coding agents that turns process, Git, validation, usage, cost, and human-outcome evidence into an explainable, confidence-aware session report.

### 30-second pitch

Coding agents can say they completed a task, but a successful process exit is not proof that the code is correct, accepted, or efficient. TokenFaxx wraps an agent session or instruments it through a TypeScript SDK, records privacy-safe metadata, runs explicitly configured validations, and stores versioned evidence in local SQLite. It computes a deterministic score only when enough evidence exists and uses AI only for bounded task classification and evidence-grounded narrative explanation. Missing measurements remain unavailable rather than silently becoming zero.

### Two-minute pitch

TokenFaxx addresses a trust and observability problem in AI-assisted software engineering. Teams can see an agent's final diff, but usually cannot answer, in one place:

- What task was attempted?
- Did the process merely exit successfully, or did tests, build, lint, and type checking pass?
- Which Git changes and commits appeared within the session boundary?
- What model, tokens, and cost were reported by the provider?
- Was the work later accepted or rejected by a human?
- How strong is the evidence behind each conclusion?
- Can two agent runs be compared on the same task and starting state?

TokenFaxx creates an evidence graph for each session. The CLI is the easy adoption path: it launches Codex, Claude, or a custom command, samples Git metadata, runs approved validation commands, and generates a report. The SDK is the accuracy path: an agent host can record official provider usage and tool lifecycle data directly. SQLite keeps the default deployment private and simple. Deterministic rules remain authoritative; optional OpenRouter calls receive only bounded, sanitized inputs and cannot overwrite validation or benchmark verdicts.

The project is an alpha local developer product, not yet a hosted enterprise platform. Its MVP slice is real and usable, while provider-native CLI telemetry, PR/CI enrichment, calibrated benchmark cohorts, robust migrations, and team collaboration remain roadmap work.

## 2. The problem and product thesis

### The problem

Agent evaluation commonly collapses several different questions into one number:

1. **Execution:** did the process run and exit?
2. **Correctness evidence:** did configured validations pass?
3. **Outcome:** was the work accepted or rejected?
4. **Attribution:** are the observed changes actually associated with this session?
5. **Efficiency:** how many tokens and dollars were used relative to a meaningful task baseline?
6. **Reproducibility:** was another run given the same task definition and starting state?
7. **Interpretation:** what are the strengths, anomalies, and missing facts?

If these are mixed together, a tool can confidently produce a misleading answer. For example, exit code `0` could mean only that an interactive CLI closed normally. It does not mean the requested feature works.

### The thesis

Agent evaluation should be evidence-first:

- collect facts close to their authoritative source;
- preserve provenance and confidence;
- distinguish observed, provider-reported, calculated, and inferred values;
- keep missing data missing;
- make deterministic checks authoritative;
- use AI to explain evidence, not invent it;
- compare runs only when task and starting state are sufficiently equivalent.

### Product invariants

These are the decisions worth defending in an interview:

- TokenFaxx evaluates a session, never a developer.
- Lines changed and token counts are context, not standalone productivity measures.
- Process success, validation, acceptance, and benchmark success are separate concepts.
- A missing value is `null`/Unavailable, not zero.
- AI analysis cannot change a deterministic outcome or benchmark verdict.
- Interactive terminal content, source code, diffs, prompts, responses, environment values, and secrets are not stored.
- Validation commands are user-controlled executable code and are never silently invented or enabled.
- A comparison may refuse to declare a winner.

## 3. Who it is useful for

### Individual developers

- Keep a local record of agent sessions.
- See which validations actually ran.
- Compare controlled attempts at the same task.
- Find missing usage, outcome, or attribution evidence.
- Export reports for personal analysis.

### Agent builders

- Instrument provider responses through the SDK.
- Record exact or provider-reported token usage.
- Record tool calls and explicit outcomes.
- Add custom pricing with provenance.
- Use the event model as a stable integration boundary.

### Engineering teams, eventually

- Standardize benchmark tasks.
- Compare agent/model configurations on reproducible starting commits.
- Join sessions with PR, review, CI, merge, and regression outcomes.
- Monitor reliability, cost, and evidence quality across approved cohorts.

The last group is the product direction, not the current deployment model. The current implementation is intentionally local and single-user.

## 4. What is implemented today

| Capability         | Current behavior                                                                   | Important limitation                                                   |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CLI initialization | Creates `tokenfaxx.config.ts`, `.tokenfaxx/tokenfaxx.db`, and a `.gitignore` entry | The TypeScript config is executable code and should be reviewed        |
| Agent launch       | Codex, Claude, or a custom shell command                                           | CLI wrappers do not have provider-native usage telemetry               |
| Terminal UX        | Preserves interactive stdin/stdout/stderr, color, and signal forwarding            | Output is intentionally not stored                                     |
| Git collection     | Before/after snapshots plus periodic metadata-only samples                         | Association is not proof of causation                                  |
| Validation         | Test, build, lint, and typecheck commands with timeouts                            | Human-readable parsers are heuristic                                   |
| Event model        | Versioned, Zod-validated event envelopes and payloads                              | Schema migration/version evolution is still early                      |
| Storage            | Local SQLite, foreign keys, WAL, transactions, projections, retention, deletion    | Migration SQL is embedded and concurrent-writer hardening is limited   |
| Scoring            | Deterministic weighted components and confidence                                   | Task token baselines are transparent but not empirically calibrated    |
| Reports            | Terminal, JSON, JSONL, and CSV                                                     | No dashboard or trend UI                                               |
| Outcomes           | Automatic provisional outcome plus explicit `mark-outcome`                         | No automatic GitHub PR/CI/review enrichment                            |
| Comparison         | Confidence-gated comparison; can decline a winner                                  | General sessions are less controlled than benchmarks                   |
| Benchmarks         | Detached worktree, hashed definition/start, enforced checks                        | Cohort calibration and broad fixture coverage remain                   |
| AI task profiling  | Opt-in structured OpenRouter classification                                        | Model confidence is self-reported until calibrated                     |
| AI report analysis | Sanitized structured narrative with verified event citations                       | Not a correctness judge; cost cap is checked after response            |
| SDK                | Session, usage, tools, arbitrary typed events, outcomes, completion                | The SDK does not yet run Git collection, validation, or scoring itself |
| Packaging          | Standalone CLI artifact and clean-install verifier exist                           | As of this guide, `tokenfaxx` is not yet public on npm                 |
| CI/license         | MIT license and Node 20/22 CI are present                                          | Broader OS matrix, provenance, changelog, and security policy remain   |

## 5. Architecture

```text
                         user-controlled repository
                                    |
                     tokenfaxx init / run / benchmark
                                    |
                  +-----------------+-----------------+
                  |                                   |
          CLI adapter launch                    TypeScript SDK
      Codex / Claude / custom command       provider/tool callbacks
                  |                                   |
                  +-----------------+-----------------+
                                    |
              +---------------------+----------------------+
              |                     |                      |
       process lifecycle       Git metadata          validation commands
       exit + duration         boundaries + timeline  test/build/lint/tsc
              |                     |                      |
              +---------------------+----------------------+
                                    |
                      versioned, validated events
                                    |
                atomic append + normalized projections
                                    |
                         local SQLite database
                                    |
                 +------------------+------------------+
                 |                                     |
       deterministic scoring                  report/export/compare
                 |                                     |
                 +---------- authoritative ------------+
                                    |
                      optional sanitized metadata
                                    |
                    OpenRouter narrative/profile
                         non-authoritative AI
```

### Why this shape is appropriate for an MVP

- A CLI wraps tools developers already use, reducing adoption friction.
- An SDK provides a more accurate path where the host controls provider calls.
- An append-only event stream preserves history while normalized tables make reports practical.
- SQLite gives zero-operations local persistence and supports transactions, foreign keys, and WAL.
- Deterministic scoring is testable and auditable.
- Optional AI adds usability without making an LLM the source of truth.

### Why this is not yet the hosted architecture

A multi-user product would require authenticated ingestion, tenant/project isolation, a durable queue, idempotent workers, Postgres or another server database, object storage, asynchronous analysis jobs, RBAC, an immutable audit log, retention workflows, and operational SLOs. Building those before validating local evidence quality would add cost without fixing the core trust problem.

## 6. Repository map

```text
TokenFaxx/
├── apps/
│   └── cli/                 command definitions and orchestration
├── packages/
│   ├── core/                schemas, config, evidence, pricing, benchmarks
│   ├── storage/             SQLite schema, transactions, projections, queries
│   ├── collectors/          Git collection and validation execution/parsing
│   ├── adapters/            Codex, Claude, shell, and SDK capability contracts
│   ├── scoring/             deterministic scoring and confidence
│   ├── analysis/            bounded OpenRouter integrations
│   ├── sdk/                 in-process instrumentation API
│   └── shared/              IDs, timestamps, redaction, CSV helpers
├── examples/                benchmark and SDK examples
├── docs/                    architecture and product documentation
├── .github/workflows/       continuous integration
├── LICENSE                  MIT license
├── package.json             private pnpm/Turborepo workspace root
├── pnpm-workspace.yaml      workspace membership
└── turbo.json               task graph
```

### Package responsibility and dependency direction

| Area         | Owns                                            | Should not own                              |
| ------------ | ----------------------------------------------- | ------------------------------------------- |
| `core`       | stable domain contracts                         | process spawning, storage, network requests |
| `shared`     | small generic primitives                        | TokenFaxx product policy                    |
| `storage`    | persistence and query behavior                  | CLI presentation or AI interpretation       |
| `collectors` | observation from Git and validators             | scoring conclusions                         |
| `adapters`   | capability declaration and launch specification | storage or report generation                |
| `scoring`    | pure deterministic evaluation                   | external calls or command execution         |
| `analysis`   | bounded AI calls and response validation        | authoritative verdicts                      |
| `sdk`        | embedded instrumentation facade                 | interactive CLI orchestration               |
| `apps/cli`   | workflow coordination and user interface        | reusable domain rules where avoidable       |

One present maintainability issue is that `apps/cli/src/index.ts` is large and coordinates too many concerns. A sensible refactor is to extract `SessionRunner`, `ReportService`, and `BenchmarkRunner`, while keeping pure domain logic in the packages that already own it.

## 7. End-to-end CLI session lifecycle

The main implementation is `runTracked()` in `apps/cli/src/index.ts`.

1. **Load and validate configuration.** `loadConfig()` imports `tokenfaxx.config.ts` through `jiti` and validates it with Zod. A bundled alias lets a globally installed CLI resolve `defineConfig` without requiring the tracked repository to install `@tokenfaxx/core`.
2. **Validate AI prerequisites.** `--ai-profile` requires a task description and `OPENROUTER_API_KEY`.
3. **Select and detect an adapter.** The adapter declares what it can and cannot report.
4. **Read repository metadata.** The Git collector identifies the repository, remote, branch, HEAD, status, and diff summary.
5. **Open local storage.** The database lives at `.tokenfaxx/tokenfaxx.db`; configured retention is applied.
6. **Create a session.** A project is upserted by repository path and the session begins with status `running`.
7. **Persist the starting boundary.** A `before` Git snapshot and `session.started` event are recorded.
8. **Build a task profile.** Explicit task type and complexity are recorded. Benchmark identity, maximum cost, and tags may also be included.
9. **Optionally profile the task with AI.** Only the description is sent. Explicit user fields win; low-confidence complexity remains unknown.
10. **Start periodic Git sampling.** Every configured interval, file path/status/size/mtime and HEAD metadata are observed. File content is not read into the event stream.
11. **Launch the agent as a child process.** The CLI preserves the interactive terminal. Custom commands run through the shell and use a POSIX process group where supported.
12. **Forward interruption signals.** `SIGINT`/`SIGTERM` are sent to the child or custom command group.
13. **Record process completion.** Exit code, duration, and passed/failed/interrupted status become a `command.completed` event.
14. **Run enabled validations.** Test, build, lint, and typecheck commands execute sequentially with bounded captured output, live forwarding, timeouts, and optional parsers.
15. **Stop timeline collection.** A final Git sample is taken.
16. **Persist the ending boundary.** The collector computes commits and changed file metadata between before and after.
17. **Derive a provisional task outcome.** Interruption becomes `attempted`; non-zero child exit becomes `failed`; zero exit without validations becomes `completed-unverified`; all validations passing becomes `completed-validated`; otherwise it becomes `partially-completed`.
18. **Complete the session.** `task.outcome`, `session.completed`, and the normalized session state are stored.
19. **Calculate deterministic evaluation.** Scoring uses only available evidence.
20. **Evaluate benchmark expectations, if applicable.** The deterministic benchmark verdict is stored as an event.
21. **Optionally request AI narrative analysis.** Failure here does not erase or fail the completed local session.
22. **Render the report.** The CLI returns the child process exit code, except benchmark expectation failure has its own exit code.

### Failure behavior

- An agent process failure records an `error` event where possible and finalizes the session as failed.
- An AI profiling failure falls back to deterministic/user input and does not block the agent.
- An automatic post-run AI analysis failure prints an unavailable warning and preserves the deterministic report.
- Validation timeout sends `SIGTERM`, then `SIGKILL` after two seconds when necessary.
- A signal-interrupted tracked run exits `130`.
- A host crash can leave a session `running`; active runs now maintain a heartbeat, `doctor` reports expired heartbeats, and explicit `doctor --repair` finalizes confirmed stale sessions as interrupted.

## 8. Event and evidence model

### Why events exist

Events preserve what happened, while projection tables make common queries efficient. This is a lightweight event-sourced design, not a claim of full event-sourcing infrastructure.

Every event has:

- UUID event ID;
- schema version;
- owning session ID;
- ISO timestamp;
- agent;
- repository;
- optional task ID;
- a known event type;
- a type-validated payload;
- metadata.

The database rejects an event whose agent, repository, or task ID does not match its owning session. An identical repeated event ID is an idempotent no-op; the same ID with different content is a conflict. Event insertion and normalized projection happen in the same SQLite transaction.

### Event types

| Event                  | Meaning                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `session.started`      | adapter and starting Git boundary context                         |
| `session.completed`    | final process state, exit code, and duration                      |
| `model.usage`          | provider/model/token/cost observation                             |
| `tool.started`         | declared tool start; currently mainly an integration contract     |
| `tool.completed`       | tool name, action, success, and duration                          |
| `file.changed`         | created/modified/deleted/renamed path metadata                    |
| `command.completed`    | command category, exit, duration, retry, and status               |
| `test.completed`       | summarized test validation state                                  |
| `build.completed`      | summarized build validation state                                 |
| `lint.completed`       | summarized lint validation state                                  |
| `typecheck.completed`  | summarized typecheck state                                        |
| `git.commit.created`   | commit observed between session boundaries                        |
| `git.sampled`          | periodic metadata-only working tree sample                        |
| `task.profiled`        | task type, complexity, provenance, benchmark, and AI profile data |
| `benchmark.evaluated`  | immutable deterministic checks and verdict                        |
| `analysis.completed`   | separate non-authoritative AI narrative snapshot                  |
| `validation.completed` | full validation status and parsed details                         |
| `task.outcome`         | provisional or explicit outcome evidence                          |
| `error`                | categorized process/integration error                             |

### Measurement taxonomy

Reports describe values as:

- `observed`: directly read from the operating system, Git, or stored state;
- `provider-reported`: returned by an official provider response;
- `calculated`: derived from known inputs and an explicit formula/configuration;
- `inferred`: derived from deterministic rules with limitations;
- `llm-inferred`: generated by a model and labeled accordingly.

An `EvidenceValue<T>` carries value, measurement type, source, confidence, timestamp, limitations, and optional supporting event IDs. This is more useful than returning only a number because consumers can decide whether the evidence is strong enough for their use case.

## 9. Storage model

The database uses `better-sqlite3` and Drizzle ORM.

| Table                | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `projects`           | repository identity and remote                  |
| `sessions`           | session lifecycle and task association          |
| `events`             | immutable versioned domain events               |
| `model_usage`        | queryable usage and cost projection             |
| `tool_calls`         | completed tool observations                     |
| `command_runs`       | command lifecycle projection                    |
| `validation_runs`    | validator status and parsed detail JSON         |
| `git_snapshots`      | before/after Git boundary metadata              |
| `task_outcomes`      | chronological provisional and explicit outcomes |
| `score_snapshots`    | current deterministic evaluation snapshot       |
| `analysis_snapshots` | separate AI narratives keyed by evidence hash   |
| `_migrations`        | applied migration versions                      |

### Storage properties

- Foreign keys are enabled.
- Child records cascade when a session is deleted.
- WAL mode improves local read/write behavior.
- The directory is created with mode `0700` and the database is hardened to `0600` on POSIX where possible.
- Event payloads use stable canonical JSON ordering.
- Event and projection writes are atomic.
- Retention deletes old sessions according to `privacy.retentionDays`.

### Current storage limitations

- Migration bootstrap and column upgrades are embedded in `database.ts`, not immutable checked migration files.
- A five-second SQLite `busy_timeout` handles short writer contention, but there is no higher-level retry strategy for many concurrent SDK writers.
- Bulk export performs per-session bundle queries and is not optimized for very large histories.
- There is no backup/restore command or corruption recovery flow.
- Identical repeated completion is idempotent, conflicting completion is rejected atomically, and heartbeat-based stale-session repair is explicit; automatic process-liveness proof across machines is still out of scope.

SQLite remains the right default for a private, local MVP. These limitations become urgent only as concurrency, data lifetime, or hosted use increases.

## 10. Git evidence and attribution

### What is observed

- current branch and HEAD;
- staged/working-tree status codes;
- changed file paths;
- working-tree file size and modification time during sampling;
- commit hashes created between boundaries;
- insertion/deletion summaries;
- whether uncommitted changes remain.

### What is deliberately not stored

- source file contents;
- patch/diff contents;
- terminal output;
- commit message content.

### Attribution score

Attribution starts at `5` and gains:

- `+25` for an explicit task ID;
- `+20` for a benchmark ID/profile;
- `+30` when commits appear between boundaries;
- `+15` when file changes are observed;
- `+10` when at least one validation passes.

It is clamped to 100 and labeled low below 45, medium from 45, and high from 75.

The wording is intentionally cautious: “Likely associated with this session,” “Estimated association,” or “Insufficient attribution evidence.” Git proximity does not prove the child process caused every change, especially if the repository was already dirty or another process was editing it.

### Rework estimate

Rework is a metadata heuristic. It looks for:

- files changing across multiple sampled intervals;
- newly observed files disappearing before completion;
- failed validations.

It does not understand semantic backtracking, code quality, or whether repeated edits were necessary exploration. It should be presented as a process signal, never as a developer-quality judgment.

## 11. Validation system

### Supported validation categories

- `test`
- `build`
- `lint`
- `typecheck`

Each definition contains a command, timeout, enabled flag, parser, and optional result file.

### Parsers

| Parser       | Input                    | Extracted details                      | Main caveat                                    |
| ------------ | ------------------------ | -------------------------------------- | ---------------------------------------------- |
| `auto`       | output/result file       | chooses Jest/Vitest/TypeScript or none | detection is heuristic                         |
| `jest`       | JSON or terminal summary | suites/tests passed, failed, skipped   | terminal parsing is fragile                    |
| `vitest`     | JSON or terminal summary | files/tests passed, failed, skipped    | result-file mode is stronger                   |
| `junit`      | XML-like result file     | tests passed, failed, skipped          | current regex parsing is not a full XML parser |
| `eslint`     | JSON                     | diagnostics and warnings               | command must emit JSON                         |
| `typescript` | compiler output          | TS diagnostic count                    | counts text patterns                           |
| `none`       | exit code                | no detailed metrics                    | only pass/fail evidence                        |

Validation output is streamed to the terminal but only a bounded amount is retained in memory for parsing; raw output is not persisted. A configured machine-readable `resultFile` is stronger evidence. Result files are resolved to real paths, must remain regular files inside the validation working directory, and are rejected when they escape through an absolute/parent path or symlink or exceed the configured output-size limit.

### Security model for commands

Validation and custom commands run through a shell with the user's permissions. Therefore:

- `init` does not enable detected scripts unless `--yes` is supplied;
- users must inspect configuration from repositories they do not trust;
- AI never generates and automatically executes a validation command;
- a future safer configuration could support argv arrays and a non-executable JSON format.

## 12. Task outcomes

| Outcome                | Normalized value | Outcome confidence | Meaning                                        |
| ---------------------- | ---------------: | -----------------: | ---------------------------------------------- |
| `unknown`              |      unavailable |                 10 | no usable outcome evidence                     |
| `attempted`            |               20 |                 35 | work started but was interrupted/incomplete    |
| `partially-completed`  |               50 |                 55 | some configured evidence failed                |
| `completed-unverified` |               70 |                 55 | process exited successfully without validation |
| `completed-validated`  |               90 |                 85 | all configured validation passed               |
| `accepted`             |              100 |                100 | user explicitly reported acceptance            |
| `rejected`             |               10 |                100 | user explicitly reported rejection             |
| `failed`               |                0 |                 90 | process failed                                 |

These are scoring policy values, not scientific truth. The important modeling decision is the ordering and explicit evidence source. A future GitHub integration should add PR/review/CI evidence rather than equating merge with correctness.

## 13. Scoring and confidence

### Default weights

| Component              | Weight |
| ---------------------- | -----: |
| outcome                |    30% |
| validation quality     |    25% |
| token efficiency       |    15% |
| cost efficiency        |    10% |
| rework                 |    10% |
| attribution confidence |    10% |

Custom weights are allowed but must sum to `1`.

### Component calculations

- **Outcome:** uses the policy table above.
- **Validation quality:** percentage of configured, non-skipped validations that passed.
- **Token efficiency:** available only when total tokens, successful-enough outcome, and known complexity exist. Initial baselines are small `15,000`, medium `40,000`, and large `100,000` tokens.
- **Cost efficiency:** available only when cost, successful-enough outcome, and a user-set maximum cost exist.
- **Rework:** `100 - estimated rework rate` when timeline evidence is sufficient.
- **Attribution:** the evidence association score described earlier.

Missing components are excluded from the weighted denominator; they are not assigned zero. That prevents an adapter with no usage channel from looking artificially efficient or inefficient.

### Score withholding

A final score is emitted only if:

- outcome confidence is at least 50;
- outcome has a numeric value;
- validation quality exists, unless the outcome is explicitly accepted/rejected;
- at least 50% of total configured scoring weight is available.

Otherwise `finalScore` is `null` and the report says evidence is insufficient.

### Overall confidence

Overall confidence is separate from the final score:

```text
overall confidence =
  30% data completeness
+ 25% attribution
+ 35% outcome confidence
+ 10% usage accuracy (or neutral 50 when unavailable)
```

Confidence labels are Low below 45, Medium from 45, and High from 75.

### What to say about accuracy

Say:

> The formulas are deterministic, explainable, and tested. Their inputs have explicit provenance and missing values remain missing. The default task baselines are initial heuristics, not yet calibrated universal benchmarks, so I would not use the composite score for employee ranking or cross-repository claims.

Do not say:

> The score proves one agent or developer is objectively better.

### How to improve scoring scientifically

1. Build frozen benchmark suites by task family, language, repository size, validation depth, and model family.
2. Repeat runs to measure variance.
3. Version every scoring formula and baseline table.
4. Publish sample size and percentile distributions.
5. Evaluate correlation with independent human review and later regression outcomes.
6. Prevent comparisons outside sufficiently similar cohorts.
7. Replay historical fixtures before changing scoring policy.

## 14. Token and cost accuracy

### Why normal CLI sessions show Unavailable

Codex and Claude interactive adapters only launch an executable. Decorative terminal text is not a stable, documented telemetry API. Scraping it would be version-fragile and may silently report wrong values. Their capability declarations therefore say exact token usage, model identity, tool events, lifecycle hooks, and cost reporting are unsupported.

This is expected behavior, not a database failure.

### The accurate path

Use the SDK in the agent host and pass fields returned by the official provider response. A usage record can include:

- provider and exact model ID;
- input, output, cached input, reasoning, and total tokens;
- reported or calculated cost;
- measurement type and source;
- pricing effective date.

If the caller does not provide cost, TokenFaxx calculates it only when provider and model exactly match one user-configured pricing entry and token inputs are present. It never silently guesses a price and never overwrites a caller-provided cost.

### Production direction

Provider integrations should use official event streams, SDK callbacks, or a documented side channel. Every adapter should publish a tested capability matrix by adapter/provider version. Terminal scraping, if ever supported, must be explicitly labeled estimated with low confidence and parser provenance.

## 15. Adapter model

| Adapter      | Launches interactively | Exact usage | Model ID | Tool events | Cost | Lifecycle hooks |
| ------------ | ---------------------- | ----------- | -------- | ----------- | ---- | --------------- |
| Codex CLI (`codex`) | yes | no | no | no | no | no |
| Codex structured (`codex-json`) | no | provider-reported | when emitted | no | when emitted/configured | yes |
| Claude CLI (`claude`) | yes | no | no | no | no | no |
| Claude structured (`claude-json`) | no | provider-reported | when emitted | no | provider-reported/configured | yes |
| Custom shell | yes | no | no | no | no | no |
| SDK | no | yes | yes | yes | yes | yes |

An adapter implements:

- a unique name and version;
- capability flags;
- `detect()`;
- a launch specification.

`registerAdapter()` supports in-process extension, but there is not yet a discoverable, versioned, signed third-party adapter plugin system.

## 16. AI features and trust boundaries

### AI task profiling

Command:

```bash
tokenfaxx run --agent codex \
  --task "Fix intermittent cache invalidation after tenant rename" \
  --ai-profile
```

Only the task description, capped at 4,000 characters, is sent to OpenRouter. The response is strict structured JSON containing task type, complexity, self-reported confidence, rationale, missing evidence, and generic tags.

Rules:

- explicit `--task-type` and `--complexity` always win;
- AI complexity affects token-efficiency scoring only at confidence `>= 70`;
- otherwise complexity remains `unknown`;
- the provider, model, generation ID, usage, and cost are stored as inference provenance;
- a request failure falls back without failing the coding session.

### Narrative report analysis

Commands:

```bash
tokenfaxx report --analysis openrouter
tokenfaxx report --analysis openrouter --refresh-analysis
```

The analyzer receives a bounded allowlisted evidence object. It excludes source code, diffs, repository paths, task descriptions, free-form commands, errors, reasons, prompts, responses, environment values, and secrets. File paths are replaced by aliases.

The model must return:

- summary;
- strengths;
- concerns;
- anomalies with evidence event IDs and confidence;
- missing evidence;
- recommendations;
- disclaimer.

The response is Zod-validated. Any anomaly citing an event ID that was not transmitted is rejected. The evidence payload is SHA-256 hashed, and the narrative is stored in its own snapshot table with the label `narrative-only; deterministic evidence remains authoritative`.

### Why AI is useful here

AI is good at compressing a large evidence record into a readable explanation and at classifying an ambiguous task description. It is not trustworthy enough to invent correctness, acceptance, token counts, causality, or benchmark results.

### Cost caveat

`analysis.maxCostUsd` is checked against provider-reported cost after the response arrives. It detects an overrun but cannot prevent already-billed usage. A hard budget requires provider-side limits, a gateway, or pre-request token/rate controls.

## 17. Privacy and security

### Defaults enforced by schema

The following configuration values are literal `false`, not merely defaults:

- `storePrompts`
- `storeResponses`
- `storeTerminalOutput`
- `storeDiffContents`
- `analysis.sendSourceCode`
- `analysis.sendDiffContents`
- `analysis.sendPrompts`

This makes privacy a product constraint in version `0.1.0`, not an option users can accidentally enable.

### Secret handling

The SDK redacts common secret patterns before storing event payloads and metadata. API keys are read from environment variables and are not stored in configuration. Redaction is defense in depth; callers should still avoid placing sensitive free-form text in custom events.

### Main threats still to address

- malicious executable TypeScript configuration;
- shell command injection through unreviewed config;
- result-file path or symlink escape;
- prompt injection inside metadata sent to AI;
- SQLite tampering/corruption;
- exported reports containing user-entered reasons/task descriptions;
- native dependency supply-chain risk;
- absent signed provenance/SBOM;
- insufficient fuzz/property tests for redaction and sanitization.

### Responsible claim

TokenFaxx has strong privacy-safe defaults for a local alpha. It has not undergone a formal security audit and should not yet be described as enterprise hardened.

## 18. Configuration reference

File: `tokenfaxx.config.ts`

```ts
import { defineConfig } from "@tokenfaxx/core";

export default defineConfig({
  project: {
    name: "my-project",
  },
  collection: {
    gitSampleIntervalMs: 3_000,
    maxValidationOutputBytes: 500_000,
  },
  validation: {
    test: {
      command: "npm test -- --run",
      timeoutMs: 120_000,
      enabled: true,
      parser: "vitest",
      // resultFile: ".tokenfaxx/vitest.json",
    },
    build: {
      command: "npm run build",
      timeoutMs: 120_000,
      enabled: true,
      parser: "none",
    },
    lint: {
      command: "npm run lint",
      timeoutMs: 120_000,
      enabled: true,
      parser: "eslint",
      // resultFile: ".tokenfaxx/eslint.json",
    },
    typecheck: {
      command: "npm run typecheck",
      timeoutMs: 120_000,
      enabled: true,
      parser: "typescript",
    },
  },
  scoring: {
    weights: {
      outcome: 0.3,
      validationQuality: 0.25,
      tokenEfficiency: 0.15,
      costEfficiency: 0.1,
      rework: 0.1,
      attributionConfidence: 0.1,
    },
  },
  privacy: {
    storePrompts: false,
    storeResponses: false,
    storeTerminalOutput: false,
    storeDiffContents: false,
    retentionDays: 90,
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
  analysis: {
    enabled: false,
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    timeoutMs: 30_000,
    maxCostUsd: 0.05,
    sendSourceCode: false,
    sendDiffContents: false,
    sendPrompts: false,
  },
});
```

### Configuration constraints

- Node sampling interval: `1,000` to `60,000` ms.
- Captured validation output: positive, maximum 5 MB.
- Validation timeout: positive, maximum one hour.
- Analysis timeout: positive, maximum two minutes.
- Scoring weights: each from 0 to 1 and total exactly 1 within tolerance.
- Duplicate custom provider/model pricing entries are rejected.
- Retention days must be a positive integer.

## 19. Complete CLI reference

### Global

```bash
tokenfaxx --version
tokenfaxx --help
```

The CLI requires Node.js 20 or newer and Git for meaningful repository tracking.

### `init`

```bash
tokenfaxx init
tokenfaxx init --yes
```

Creates the config, database, and ignore entry in the current directory. Without `--yes`, detected `package.json` scripts are reported but not enabled. With `--yes`, detected `test`, `build`, `lint`, and `typecheck` scripts become `npm run ...` validation definitions.

It refuses to overwrite an existing `tokenfaxx.config.ts`.

### `doctor`

```bash
tokenfaxx doctor
```

Checks Node version, Git, repository status, database access, stale heartbeats, and adapter executables. It does not execute the TypeScript configuration by default; `--execute-config` opts into parsing it after repository trust is established. `--repair` explicitly finalizes confirmed stale sessions as interrupted. Warnings for an adapter you do not plan to use are informational. Machine-readable output and stronger required-check exit semantics remain future work.

### `run`

```bash
tokenfaxx run --agent codex [options] [adapter passthrough arguments]
tokenfaxx run --agent claude [options] [adapter passthrough arguments]
tokenfaxx run --command "reviewed shell command" [options]
```

Options:

| Option                        | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `--agent <adapter>`           | `codex` or `claude`; `sdk` cannot be launched interactively            |
| `--command <command>`         | selects the `custom` shell adapter                                     |
| `--task-id <id>`              | explicit external task identity; improves attribution                  |
| `--task <description>`        | human-readable task and AI profile input                               |
| `--task-type <type>`          | `bugfix`, `feature`, `refactor`, `migration`, `investigation`, `other` |
| `--complexity <level>`        | `small`, `medium`, `large`, `unknown`                                  |
| `--benchmark-id <id>`         | task grouping only; use benchmark mode for reproducibility             |
| `--maximum-cost-usd <amount>` | denominator for cost efficiency when cost exists                       |
| `--ai-profile`                | opt-in OpenRouter classification of the task description               |

Unknown/excess arguments are passed through for interactive adapters. For example:

```bash
tokenfaxx run \
  --agent codex \
  --task-id ENG-142 \
  --task "Fix notification migration" \
  --task-type bugfix \
  --complexity medium \
  --maximum-cost-usd 5
```

### `sessions`

```bash
tokenfaxx sessions
tokenfaxx sessions --agent codex --task-id ENG-142 --limit 50
```

Prints tab-separated session ID, start time, agent, task ID, and status. Default limit is 20.

### `report`

```bash
tokenfaxx report
tokenfaxx report --session <uuid>
tokenfaxx report --session <uuid> --format terminal
tokenfaxx report --session <uuid> --format json
tokenfaxx report --session <uuid> --format jsonl
tokenfaxx report --session <uuid> --format csv
tokenfaxx report --analysis openrouter
tokenfaxx report --analysis openrouter --refresh-analysis
```

Without a session ID, it selects the latest session. `--no-color` is accepted through Commander; current terminal rendering is plain text already. OpenRouter mode reuses the latest stored analysis unless refresh is requested.

### `mark-outcome`

```bash
tokenfaxx mark-outcome <session-id> \
  --status accepted \
  --reason "PR merged after review"
```

Allowed statuses are `unknown`, `attempted`, `partially-completed`, `completed-unverified`, `completed-validated`, `accepted`, `rejected`, and `failed`. This appends explicit human outcome evidence and recalculates the score. It does not rewrite history.

### `compare`

```bash
tokenfaxx compare <session-a> <session-b>
```

Outputs JSON with comparison confidence, basis, possible winner, and both report summaries.

- same benchmark definition hash and starting commit: 100 confidence;
- same task and starting commit outside benchmark mode: 85;
- same task only: 65;
- benchmark identities/hashes that do not match: 40;
- unrelated sessions: 20.

A winner is declared only at confidence `>= 65` and when both final scores exist. This prevents visually precise but invalid comparisons.

### `export`

```bash
tokenfaxx export --format json
tokenfaxx export --format jsonl
tokenfaxx export --format csv
tokenfaxx export --session <uuid> --format json
```

Without a session, exports up to 10,000 recent sessions. JSON and JSONL preserve nested evidence. CSV intentionally flattens a narrower set of report fields.

### `delete-session`

```bash
tokenfaxx delete-session <session-id>
```

Deletes the session and cascades its child evidence. This is irreversible unless the database has been backed up.

### `delete-all-data`

```bash
tokenfaxx delete-all-data --yes
```

The explicit confirmation flag is required. It removes session/project data from the local database.

### `benchmark run`

```bash
tokenfaxx benchmark run \
  --task examples/benchmark.json \
  --agent codex

tokenfaxx benchmark run \
  --task benchmark.json \
  --agent custom \
  --command "node agent.js"
```

The primary repository must be clean. A temporary detached worktree is created at the resolved starting revision. Optional setup runs there, then the agent and benchmark validations run there. Successful worktrees are removed; failed worktrees are preserved and printed for debugging.

Exit codes:

- `0`: agent exited successfully and all expectations were met;
- `2`: an expectation was unmet or missing;
- `130`: interrupted;
- otherwise: agent process failure code, commonly `1`.

### `benchmark compare`

```bash
tokenfaxx benchmark compare --benchmark <benchmark-id>
```

Returns report objects for up to 100 sessions associated with the benchmark. For a direct winner decision, `compare` still applies the comparison confidence rules.

## 20. Benchmark design and reproducibility

Example:

```json
{
  "id": "fix-notification-migration",
  "description": "Fix the failing notification settings migration",
  "repository": ".",
  "startingCommit": "HEAD",
  "timeoutMs": 900000,
  "setup": "pnpm install --frozen-lockfile",
  "validation": {
    "test": "pnpm test",
    "typecheck": "pnpm typecheck"
  },
  "expectedOutcome": {
    "testsPass": true,
    "typecheckPasses": true
  },
  "maximumCostUsd": 5,
  "tags": ["migration"]
}
```

### Validity rules

- At least one expected outcome is required.
- Every expectation must have its matching validation.
- Every validation must have its matching expectation.
- Unknown keys are rejected.
- The primary worktree must be clean.

### Definition identity

TokenFaxx resolves `startingCommit` to an immutable SHA, canonicalizes the definition, adds the hash format version, and computes SHA-256. This captures setup, validation commands, expectations, limits, tags, and the resolved start. Two executions with different definitions or starts should not be treated as the same controlled experiment.

### Why detached worktrees matter

They isolate agent changes from the developer's primary working tree while reusing Git object storage. This is safer and faster than copying a repository and more reproducible than running on whatever branch state happens to be open.

### What benchmark PASS means

It means the declared checks matched the declared expected booleans in that worktree. It does not mean all possible correctness, security, UX, or performance requirements were tested. Benchmark quality is bounded by its validations.

## 21. SDK reference

The SDK source package is `@tokenfaxx/sdk` inside this workspace.

Important release truth: the first prepared npm artifact publishes the `tokenfaxx` CLI, not the workspace SDK packages as independent public packages. Until `@tokenfaxx/sdk` and `@tokenfaxx/core` are separately published, external SDK users need the monorepo workspace or another explicit distribution strategy.

### Main classes

#### `TokenFaxx`

Constructor options:

```ts
interface TokenFaxxOptions {
  agent: string;
  repository: string;
  adapterVersion?: string;
  databasePath?: string;
  config?: TokenFaxxConfig;
}
```

Methods:

- `startSession(options?)`: creates and starts a tracked session.
- `close()`: closes the SQLite connection.

#### `TrackedSession`

Methods:

- `recordModelUsage(usage)`
- `recordToolCall(call)`
- `recordEvent(eventType, payload, metadata?)`
- `recordOutcome(outcome)`
- `complete(result)`

### Example

```ts
import { defineConfig } from "@tokenfaxx/core";
import { TokenFaxx } from "@tokenfaxx/sdk";

const tracker = new TokenFaxx({
  agent: "my-openai-agent",
  repository: process.cwd(),
  config: defineConfig({
    pricing: {
      custom: [
        {
          provider: "openai",
          model: "provider-returned-model-id",
          inputPerMillionUsd: 1.25,
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

try {
  const providerResponse = await callYourProvider();

  await session.recordModelUsage({
    provider: "openai",
    model: providerResponse.model,
    inputTokens: providerResponse.usage.input_tokens,
    outputTokens: providerResponse.usage.output_tokens,
    cachedInputTokens:
      providerResponse.usage.input_tokens_details?.cached_tokens ?? null,
    totalTokens: providerResponse.usage.total_tokens,
    // `reported` means copied from the official response rather than estimated.
    measurement: "reported",
    source: "official provider response",
  });

  await session.recordToolCall({
    tool: "terminal",
    actionType: "test",
    success: true,
    durationMs: 830,
  });

  await session.recordOutcome({
    status: "completed-validated",
    evidence: ["Host validation pipeline passed"],
  });

  await session.complete({
    status: "completed",
    exitCode: 0,
  });
} catch (error) {
  await session.complete({
    status: "failed",
    exitCode: 1,
    taskOutcome: "failed",
  });
  throw error;
} finally {
  tracker.close();
}
```

### SDK limitations to explain

- It does not automatically take Git snapshots.
- It does not run configured validators.
- It does not calculate/save the complete score on completion.
- Repeating the same completion is a no-op and a conflicting completion is rejected, but abandoned-session recovery is not automatic.
- The caller is responsible for mapping provider fields accurately.

A high-level `evaluateSession()` or orchestration facade that mirrors CLI completion is a strong next SDK feature.

## 22. Installation, Node versions, and npm

### Current runtime requirement

- Node.js `>=20`
- CI covers Node 20 and 22.
- `.nvmrc` pins the development recommendation to Node `22.23.2`.

TokenFaxx is not intentionally limited to one patch version. `better-sqlite3` is a native addon, so a binary installed under one Node ABI may fail after switching Node versions.

Typical error:

```text
better_sqlite3.node was compiled against a different NODE_MODULE_VERSION
```

Fix by reinstalling/rebuilding dependencies under the active Node version. For a global npm install, reinstall TokenFaxx after switching Node versions. NVM keeps global packages per Node installation.

### Once the npm package is public

```bash
npx tokenfaxx@latest --version
npx tokenfaxx@latest init
```

or:

```bash
npm install --global tokenfaxx
tokenfaxx --version
```

### Current publication status

As verified on 2026-08-20, `npm view tokenfaxx version` returns `E404`: the package is not public yet. The release artifact and verifier are prepared on the `agent/npm-release` branch, but publication still requires the npm account's 2FA/automation-token authorization.

Before an interview demo, run:

```bash
npm view tokenfaxx version
```

If it is still unpublished, use the development install and state that honestly.

### Development install

```bash
git clone https://github.com/adityaapraveen/Tokenfaxx.git
cd Tokenfaxx
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
cd apps/cli
npm link
rehash
tokenfaxx --version
```

If the linked command is not found, inspect `npm prefix --global`, make sure its `bin` directory is on `PATH`, and remember that switching Node versions changes the global npm prefix. Directly running the built entry is a reliable diagnostic:

```bash
node /absolute/path/to/Tokenfaxx/apps/cli/dist/index.js --version
```

## 23. API keys and external dependencies

### Required for the deterministic product

No cloud API key is required. You need:

- Node.js 20 or 22;
- Git;
- the selected agent CLI if using Codex or Claude;
- project-specific build/test tools used by your configured validations.

### Required only for AI features

```bash
export OPENROUTER_API_KEY="your-key"
```

Keep this in the shell environment or a secure secret manager. Do not add it to `tokenfaxx.config.ts`, commit it, or paste it into reports.

### Package manager

The TokenFaxx monorepo uses pnpm `9.15.9`. A tracked project does not need pnpm unless its validation configuration invokes pnpm.

## 24. How to run a strong local demo

### Preparation

1. Use Node 22 and confirm `tokenfaxx --version`.
2. Choose a small Git repository with fast tests and typecheck.
3. Ensure the starting state is committed and clean.
4. Run `tokenfaxx init --yes` and review every generated validation command.
5. Run `tokenfaxx doctor`.
6. Prepare one tiny task that visibly changes code and one benchmark definition pinned to a commit.
7. Keep OpenRouter optional; the core demo should work without network access.

### Five-minute demo

```bash
tokenfaxx doctor

tokenfaxx run \
  --command "node demo-agent.js" \
  --task-id DEMO-1 \
  --task "Fix the demonstrated validation failure" \
  --task-type bugfix \
  --complexity small

tokenfaxx sessions
tokenfaxx report --format terminal
tokenfaxx report --format json
```

Narrate:

1. the before boundary;
2. live but non-persisted terminal output;
3. explicit validations;
4. provisional outcome versus acceptance;
5. unavailable provider metrics in wrapper mode;
6. score and confidence;
7. privacy fields in JSON.

Then add human evidence:

```bash
tokenfaxx mark-outcome <session-id> \
  --status accepted \
  --reason "Reviewed and accepted for demo"

tokenfaxx report --session <session-id>
```

Explain that this appends a new outcome rather than rewriting the prior event.

### Ten-minute technical demo

Add:

- a second run and `compare`;
- a controlled `benchmark run` showing the worktree and definition hash;
- the SDK example showing official usage fields;
- SQLite tables or JSON export showing the raw event/projection separation;
- optional AI narrative and its evidence citations.

### Demo failure plan

- Keep a known-good local custom command so the demo does not depend on an external agent login.
- Keep AI disabled unless network and credits are confirmed.
- Run validation once before the interview.
- Keep a saved JSON report as a fallback artifact.
- Never debug an npm/Node ABI problem live if a verified local build is available.

## 25. How to learn the code efficiently

Read the project in this order. The goal is to understand contracts before orchestration.

### Stage 1: domain language

1. `packages/core/src/evidence.ts` — measurement types, outcome states, task profiles.
2. `packages/core/src/events.ts` — every legal event and payload.
3. `packages/core/src/config.ts` — user-configurable policy and defaults.
4. `packages/core/src/benchmark.ts` — reproducibility and expectation rules.
5. `packages/core/src/pricing.ts` — exact-match cost calculation.

Questions to answer yourself:

- Why are outcome and process status different enums?
- Which event fields enforce ownership?
- Which privacy options cannot be enabled?
- Why does custom pricing require exact provider/model equality?

### Stage 2: deterministic decision logic

Read `packages/scoring/src/index.ts` and calculate one report by hand.

Exercises:

1. Remove usage and verify it is excluded, not scored as zero.
2. Change `completed-unverified` to `accepted` and observe confidence.
3. Compare a session with and without a task ID.
4. Explain why a score may exist with medium confidence and why those are different values.

### Stage 3: persistence

Read `packages/storage/src/schema.ts`, then `packages/storage/src/database.ts`.

Trace one `model.usage` event:

```text
parseEvent -> verify session envelope -> insert events row
           -> insert model_usage projection -> commit transaction
```

Exercises:

- Find the idempotent retry behavior.
- Find the conflicting event-ID behavior.
- Identify which deletions cascade.
- Explain why stable JSON matters.

### Stage 4: observation boundaries

Read `packages/collectors/src/index.ts`.

Trace:

- before snapshot;
- interval sampling;
- after snapshot;
- boundary comparison;
- validation process timeout and parsing.

Ask what can be inferred from Git metadata and what cannot.

### Stage 5: adapters and SDK

Read `packages/adapters/src/index.ts`, then `packages/sdk/src/index.ts`.

Compare the wrapper and SDK evidence paths. Be able to explain why the SDK has higher measurement accuracy but more integration work.

### Stage 6: AI

Read `packages/analysis/src/index.ts`.

Find:

- strict JSON schemas;
- temperature zero;
- timeouts and output token limits;
- post-response cost check;
- evidence hash;
- anomaly citation validation;
- description length limit.

Then read `sanitizedEvidenceBundle()` in the CLI and list every excluded free-form field.

### Stage 7: orchestration and presentation

Read `runTracked()` and command registration in `apps/cli/src/index.ts`, followed by `apps/cli/src/report.ts` and `apps/cli/src/benchmark.ts`.

Draw the sequence from `run` to terminal report without looking at this guide. If you can explain where each failure is caught and which data survives it, you understand the project.

### Stage 8: tests

Read tests next to each implementation. Focus on invariants, not only happy paths:

- event mismatch/idempotency;
- missing scoring inputs;
- malformed AI output and unknown citations;
- validation parser fallbacks;
- benchmark hash and expectation mismatch;
- CLI signals and direct symlink execution;
- package clean-install verification.

## 26. Development, testing, and release workflow

### Common commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm format
```

The root uses Turborepo to run package scripts in dependency order.

### CLI package verification

```bash
pnpm --filter tokenfaxx build
pnpm --filter tokenfaxx package:check
```

The CLI build uses esbuild to bundle internal workspace packages into a standalone distributable while leaving real runtime dependencies external. The package verifier packs the exact artifact and exercises clean installation and CLI behavior, which catches the class of problem where a monorepo build works but the npm tarball does not.

### CI

The repository runs the core quality path on Node 20 and 22. Before calling the release production-ready, extend this to macOS/Windows where possible and add dependency review, provenance/SBOM, signed tags, security policy, changelog, and release automation.

Verification snapshot on 2026-08-20: all 42 implemented tests passed, all workspace TypeScript checks passed, Markdown formatting passed, and the standalone CLI package verifier passed. The adapters package intentionally has no direct tests yet; adapter coverage is therefore still a known gap despite the green aggregate suite.

### Release checklist

1. Ensure the branch is clean and reviewed.
2. Run typecheck, tests, build, and package verification.
3. Inspect `npm pack --dry-run` output for unexpected files/secrets.
4. Verify install from the exact tarball under Node 20 and 22.
5. Confirm `npm whoami` and package-name ownership.
6. Publish with account-required 2FA or a correctly scoped granular automation token.
7. Verify `npm view tokenfaxx version` and a clean `npx tokenfaxx@latest doctor` smoke test.
8. Tag the exact commit and create release notes.

## 27. Honest limitations and roadmap

### P0: trustworthy public developer preview

- Publish and smoke-test the CLI package.
- Add ordered immutable database migrations and upgrade fixtures.
- Recover/finalize stale `running` sessions.
- Make completion idempotent.
- Constrain validation result files to repository boundaries.
- Add structured CLI errors, enum validation, `doctor --json`, and meaningful exit codes.
- Expand end-to-end, cross-platform, crash, and privacy regression tests.
- Version report/export and scoring schemas.
- Add security policy, changelog, contribution guide, provenance, and SBOM.

### P1: accurate agent evaluation pilot

- Official provider event/usage integrations.
- A local event socket or authenticated JSONL side channel.
- GitHub PR, review, CI, merge, revision, revert, and later-regression enrichment.
- High-level SDK collection/evaluation orchestration.
- Versioned and calibrated benchmark cohorts.
- Static HTML reports and trends.
- Backup/restore and scalable streaming exports.

### P2: team product

- organizations, users, projects, environments, and RBAC;
- secure authenticated ingestion and idempotency keys;
- durable queue, projection workers, Postgres/object storage;
- team dashboards, saved views, alerts, and immutable audit log;
- SSO/SAML, SCIM, tenant retention/deletion, regional controls;
- per-tenant quotas, model gateway, budget/rate limits, and billing separation.

### Features that should not be built

- AI-generated correctness verdicts without validation evidence;
- automatic acceptance inference;
- developer leaderboards based on tokens or lines changed;
- cross-task winner claims without comparable cohorts;
- hidden score adjustment by an LLM;
- silent execution of AI-generated commands;
- fabricated token/cost estimates presented as exact.

## 28. MCP use case

MCP is useful for TokenFaxx, but only after the local evidence and authorization model are stable.

### Good read-only MCP tools

- `list_sessions(filters)`
- `get_session(session_id)`
- `get_report(session_id)`
- `compare_sessions(left, right)`
- `list_benchmark_runs(benchmark_id)`
- `explain_missing_evidence(session_id)`

This would let Codex, Claude, ChatGPT, or an IDE agent ask for structured TokenFaxx context instead of parsing terminal text.

### Carefully controlled write tools

- `mark_outcome(session_id, status, reason)`
- `delete_session(session_id)`
- `run_benchmark(definition, adapter)`

Writes need explicit confirmation, project scoping, audit events, and least privilege. Arbitrary command execution should not be exposed as a general MCP tool.

### Why MCP fits the architecture

The event/report layer is already structured and local. MCP would be an activation layer over that context, not a replacement for storage or scoring. The model would retrieve authoritative evidence through narrow tools while deterministic code continues to make verdicts.

### What must exist first

- stable/versioned report contracts;
- clear database/project discovery rules;
- authorization for local or team data;
- pagination and bounded responses;
- redaction and audit logging;
- read-only default mode;
- prompt-injection defenses for stored user text;
- explicit controls for destructive or process-launching tools.

## 29. Why this project is relevant to Atlan

This section is an analogy and interview framing, not an implemented Atlan integration.

Atlan describes itself as building the context layer for enterprise AI. Its current official material emphasizes evidence-derived context, lineage, governance, lifecycle visibility, monitoring, policy, permission-scoped retrieval, metadata-only AI processing, and auditable AI-generated changes. See Atlan's [AI-Native Builder Intern page](https://intern.at.atlan.com/), [Atlan AI overview](https://docs.atlan.com/product/capabilities/atlan-ai/concepts/what-is-atlan-ai), [AI governance documentation](https://docs.atlan.com/product/capabilities/governance/ai-governance), [AI security architecture](https://docs.atlan.com/product/capabilities/atlan-ai/concepts/security), and [MCP security model](https://docs.atlan.com/product/capabilities/atlan-ai/references/mcp-security).

TokenFaxx applies similar product principles to coding-agent sessions:

| Atlan theme                    | TokenFaxx analogue                                                               | Important boundary                                 |
| ------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| context layer                  | joins task, process, Git, validation, usage, cost, and outcome                   | local session context, not enterprise data context |
| lineage                        | tracks evidence from session boundary to events, projections, score, and report  | Git association is not complete causal lineage     |
| governance                     | schema constraints, opt-in commands, privacy invariants, deterministic authority | no RBAC/policy engine yet                          |
| observability                  | lifecycle, validation, usage, cost, and confidence                               | limited provider telemetry in CLI wrapper mode     |
| AI grounded in metadata        | sends sanitized metadata, not source/diffs, and verifies citations               | only OpenRouter is implemented                     |
| human control                  | explicit outcome can supersede provisional evidence by appending history         | GitHub review workflow is not integrated           |
| auditability                   | versioned events, evidence hash, benchmark definition hash                       | local DB is mutable by its owner                   |
| context activation through MCP | proposed read-only report/session tools                                          | TokenFaxx MCP is roadmap only                      |

### Strong Atlan-oriented explanation

> I was interested in the same foundational question Atlan asks for enterprise AI: what context does an agent need, where did that context come from, and what governance makes its output trustworthy? TokenFaxx narrows that problem to coding-agent sessions. It creates a local context layer from process lifecycle, Git provenance, validation, provider usage, and human outcome. The LLM is an interpretation layer over governed metadata; deterministic evidence remains authoritative. I also designed the system to say “unavailable” and refuse invalid comparisons, because honest uncertainty is part of trustworthy AI infrastructure.

### What the interview team may value

Atlan's internship material explicitly asks candidates to discuss what they built, why they chose the problem, and the calls they made. Be ready to show:

- a working demo rather than only slides;
- one deep tradeoff, such as wrapper convenience versus SDK accuracy;
- one mistake or changed assumption;
- why missing evidence is a product feature;
- how privacy shaped the schema, not just documentation;
- which production step you deliberately postponed and why;
- how you would measure whether the scoring/profile features are actually accurate.

## 30. Interview questions and defensible answers

### “Why does this need to exist?”

Agent output is not enough to make reliability, cost, or comparison claims. TokenFaxx creates an inspectable evidence record and makes uncertainty explicit.

### “Why not use existing generic observability?”

OpenTelemetry and LLM observability platforms are valuable transport/monitoring foundations, but TokenFaxx models coding-specific outcomes: Git boundaries, validations, acceptance, reproducible task starts, and confidence-aware comparisons. A mature product could export/import OpenTelemetry rather than replace it.

### “Why SQLite?”

The MVP is local-first and single-user. SQLite avoids a service dependency while giving transactions, indexes, foreign keys, and portable storage. Moving to Postgres before team ingestion exists would be premature. Concurrency and multi-tenancy would trigger that migration.

### “Why both events and normalized tables?”

Events preserve the original typed history and enable later replay; normalized projections make report queries simple and fast. Atomic transactions prevent the event and projection from disagreeing.

### “Why can usage be unavailable?”

The interactive CLI does not expose a documented structured usage channel. Guessing from UI text would be less accurate than reporting absence. The SDK records official provider response values and is the high-accuracy path.

### “Is the score accurate?”

The implementation is deterministic and its provenance behavior is accurate to its inputs. The fixed task baselines are not yet empirically calibrated, so the score is useful as an explainable local signal, not a universal performance ranking. Controlled benchmark data is the next validation step.

### “Why include AI if deterministic logic is authoritative?”

AI helps translate a complex evidence bundle into a concise explanation and can classify task descriptions. It is intentionally outside the correctness boundary. Structured schemas, input allowlists, confidence thresholds, evidence citations, and fallback behavior reduce—not eliminate—AI risk.

### “How do you stop hallucinations?”

The system prompt restricts claims to supplied facts, the response schema is strict, every anomaly must cite an event ID, and unknown IDs cause rejection. More fundamentally, the AI result is labeled narrative-only and cannot mutate the deterministic verdict.

### “What happens when tests pass but the user rejects the work?”

Validation and acceptance remain separate. `completed-validated` is strong automated evidence; an explicit later `rejected` outcome is appended and the score recalculated. The historical events remain inspectable.

### “Can it compare Codex and Claude fairly?”

Only under a controlled benchmark with the same hashed definition and resolved starting commit is comparison confidence 100. Outside that, TokenFaxx lowers confidence or refuses a winner. Even controlled comparisons need repeated runs and calibrated cohorts because agent behavior is stochastic.

### “What would break at scale?”

Local SQLite writer contention, per-session query export, synchronous validation/analysis, lack of authenticated ingestion, and no tenant isolation. A hosted system would separate ingestion, durable events, asynchronous projections, and analysis jobs.

### “What is the biggest security risk?”

The tool intentionally runs user-configured TypeScript and shell commands. That is acceptable only for reviewed local repositories. Safer JSON/argv configuration, path containment, signing, and a formal threat model are required before untrusted/team use.

### “What would you build next?”

For reliability: immutable migrations and stale-session recovery. For accuracy: official provider usage hooks and GitHub PR/CI/review enrichment. For product usability: a static HTML report and evidence-completeness assistant. I would not build a hosted dashboard before validating these evidence paths.

### “Where did you change your mind?”

A credible answer is that a single agent-efficiency score initially seems attractive, but implementation exposes incomparable tasks and unavailable telemetry. The design therefore evolved toward confidence, provenance, score withholding, and benchmark identity rather than false precision.

## 31. Production request lifecycle evolution

A possible hosted design, when justified:

```text
CLI / SDK
  -> authenticated project-scoped ingestion API
  -> idempotency validation + schema validation
  -> append-only durable event log
  -> queue
     -> projection workers -> Postgres query model
     -> scoring workers -> versioned score snapshots
     -> enrichment workers -> GitHub/CI/review evidence
     -> AI workers -> bounded narrative snapshots
  -> API gateway / RBAC
  -> dashboard, exports, alerts, MCP
```

Production requirements:

- per-tenant keys and authorization;
- encryption in transit/at rest;
- rate limits, quotas, and spend budgets;
- idempotency keys and at-least-once delivery handling;
- schema registry/migration compatibility;
- dead-letter handling and replayable projections;
- data residency and deletion workflows;
- immutable organization audit log;
- SLOs for ingestion, projection freshness, and report availability;
- observability that itself does not leak prompts/source/secrets.

## 32. Metrics that would prove product value

Do not measure success only by installs. Measure whether TokenFaxx improves decisions:

- percentage of sessions with sufficient outcome and validation evidence;
- percentage with provider-reported usage;
- percentage linked to accepted/rejected review outcomes;
- benchmark repeatability and run-to-run variance;
- AI profile agreement with independent engineer labels;
- AI anomaly precision and citation validity;
- time users need to explain why a report reached a conclusion;
- number of invalid comparisons the system refuses;
- privacy regression failures and redaction coverage;
- stale/failed sessions recovered;
- report generation latency and local storage growth.

Avoid vanity metrics such as total tokens saved without a defensible baseline.

## 33. Glossary

| Term             | Meaning in TokenFaxx                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| adapter          | declares an agent's launch method and telemetry capabilities                            |
| attribution      | confidence that observed work is associated with the session                            |
| benchmark        | controlled task definition with a starting commit and explicit validations/expectations |
| confidence       | strength/completeness of evidence, separate from score                                  |
| deterministic    | produced by explicit code/rules rather than an LLM                                      |
| evidence         | a value plus provenance, measurement type, confidence, and limitations                  |
| event            | versioned immutable record of something observed/reported                               |
| outcome          | task state such as validated, accepted, rejected, or failed                             |
| projection       | normalized query table derived from an event                                            |
| rework           | metadata-only signal based on repeated file state changes and failed validations        |
| sanitized bundle | allowlisted metadata sent to optional report AI                                         |
| session          | one bounded agent execution or SDK-instrumented task attempt                            |
| worktree         | isolated Git checkout used for a reproducible benchmark run                             |

## 34. Final interview cheat sheet

Memorize these points:

1. TokenFaxx evaluates sessions, not people.
2. Exit `0` is execution success, not correctness.
3. Validation, acceptance, usage, attribution, and comparison are separate evidence dimensions.
4. Missing values stay unavailable.
5. CLI wrappers optimize adoption; SDK instrumentation optimizes accuracy.
6. Events preserve history; projections support queries; their writes are atomic.
7. SQLite is a deliberate local-MVP decision.
8. Benchmarks hash the definition and resolved starting commit and run in detached worktrees.
9. AI receives bounded metadata, uses strict schemas and citations, and cannot override deterministic verdicts.
10. Fixed efficiency baselines are transparent but uncalibrated.
11. The strongest next accuracy feature is official provider and GitHub/CI outcome enrichment.
12. MCP is useful as a permissioned context activation layer, starting read-only.
13. The npm CLI release is prepared but must be verified as actually published before claiming it is installable.
14. The project is a credible alpha/MVP, not yet a hosted enterprise product.

The strongest closing line is:

> TokenFaxx is not trying to make AI look certain. It is trying to make agent work inspectable: what happened, where the evidence came from, what remains unknown, and which conclusions are safe to act on.
