# TokenFaxx product audit and roadmap

Audit date: 2026-08-16  
Audited scope: all source, tests, package manifests, examples, and documentation in this repository.

## Executive assessment

TokenFaxx has a strong, unusually honest foundation for a coding-agent evaluation product. Its best decision is to separate process success, task outcome, validation evidence, usage accuracy, attribution confidence, and narrative analysis. That is more defensible than producing a single confident-looking productivity score from tokens or lines changed.

The project is an alpha-quality local developer tool, not yet a full-fledged product. The CLI/SDK vertical slice exists and typechecks, but the biggest accuracy inputs are missing from ordinary CLI sessions: exact provider usage, durable acceptance/PR/CI outcomes, and calibrated task baselines. The biggest product gaps are a hosted/team experience, release/CI operations, robust schema migrations, crash recovery, plugin distribution, and substantially broader testing.

AI should not replace deterministic evidence. Its appropriate roles here are task classification, evidence-bound explanation, anomaly triage, and recommendation generation. It should never declare that code is correct, infer acceptance, or invent token/cost values. The implemented design follows that boundary.

## Current system map

| Area                | Present              | Maturity   | Main gap                                                           |
| ------------------- | -------------------- | ---------- | ------------------------------------------------------------------ |
| CLI orchestration   | Yes                  | Alpha      | Large command module, limited input validation and recovery        |
| Local storage       | Yes, SQLite/Drizzle  | Alpha/Beta | Embedded ad-hoc migrations; event projection is now atomic         |
| Git evidence        | Yes                  | Alpha/Beta | Metadata association is not causation; force-kill recovery missing |
| Validation          | Yes                  | Alpha      | Parsers are heuristic; coverage is declared but not populated      |
| Scoring             | Yes                  | Alpha      | Fixed baselines are uncalibrated and some inputs are unreachable   |
| CLI adapters        | Codex, Claude, shell | Alpha      | No documented exact usage/tool-event capture                       |
| SDK                 | Yes                  | Alpha      | No automatic validation/Git/scoring completion path                |
| Reports/exports     | Yes                  | Alpha      | No trends/dashboard; CSV is intentionally narrow                   |
| Benchmarks          | Yes                  | Alpha      | `expectedOutcome` is parsed but not evaluated                      |
| AI narrative        | Yes, OpenRouter      | Alpha      | Needs evaluation datasets and hard provider-side budgets           |
| AI task profiling   | Added                | Alpha      | Description-only inference; calibration still required             |
| Privacy controls    | Strong defaults      | Alpha/Beta | Needs threat model, fuzzing, and secret-leak regression suite      |
| Team/cloud product  | No                   | Missing    | Identity, sync, RBAC, projects, audit log, billing                 |
| Delivery operations | No                   | Missing    | CI, releases, license, security policy, support policy             |

## What is already good

1. Evidence is typed and versioned instead of stored as arbitrary logs.
2. Missing metrics remain unavailable instead of becoming zero.
3. A successful process is not mislabeled as accepted or validated work.
4. AI analysis is stored separately from coding-agent usage and cannot overwrite deterministic results.
5. Terminal output, source, diffs, prompts, and responses are not stored by default.
6. Validation commands are opt-in and output capture is bounded.
7. Benchmark work uses detached worktrees instead of mutating the primary working tree.
8. Reports expose limitations and confidence, which is essential for responsible use.

These should remain product invariants.

## Accuracy gaps: what is missing and where

### 1. Exact usage is missing for normal CLI sessions

Where: `packages/adapters/src/index.ts`, `apps/cli/src/index.ts`.

Codex and Claude adapters only launch interactive CLIs. They correctly report that exact tokens, model identity, tool events, and cost are unavailable. As a result, token/cost efficiency is often absent for the main user path.

Production direction:

- Prefer documented provider hooks, JSON event streams, or official SDK response usage.
- Add adapter capability negotiation per provider version.
- Add a stable local event socket/JSONL side channel so agent integrations can stream signed/validated events into the active session.
- Never scrape decorative terminal output unless labeled `estimated` with a parser version and low confidence.

Acceptance criteria:

- Golden tests against documented provider fixtures.
- Every usage record includes provider, actual model, measurement type, source, and nullable fields.
- Adapter failure never silently converts unavailable usage to zero.

### 2. Configured pricing

Status: implemented for SDK-reported usage on 2026-08-18.

The SDK now calculates cost when a usage event has provider/model/input/output, no supplied cost, and exactly one configured matching price. Token and cost provenance are stored separately, including price source and effective date. Duplicate provider/model prices are rejected, and caller-supplied costs are never overwritten. Ordinary Codex/Claude CLI sessions still need a documented provider usage channel before this path can apply to them.

### 3. Task baselines are arbitrary, not calibrated

Where: `packages/scoring/src/index.ts` uses fixed 15k/40k/100k token baselines.

Those values are transparent but not empirically justified. They should not become product-wide claims.

Production direction:

- Version baselines.
- Calibrate per task family, language, repository size, model family, and validation depth using controlled benchmarks.
- Report sample size and percentile bands.
- Keep raw measurements available when no defensible comparison cohort exists.
- A/B test scoring changes on frozen fixtures before release.

### 4. Human/PR/CI outcome enrichment is only an interface

Where: `packages/core/src/integrations.ts` defines `OutcomeEnricher`, but nothing implements or invokes it.

Build GitHub first: associate branch/commit/PR, CI conclusion, review approval, merge, revision count, revert, and time-to-merge. Require explicit repository consent and least-privilege read scopes. Store source URLs/IDs and observation timestamps. Do not infer that merge equals correctness.

### 5. Benchmark expectations are unused

Where: `packages/core/src/benchmark.ts` accepts `expectedOutcome`; `apps/cli/src/index.ts` never compares results against it.

This makes benchmarks less accurate than their definition suggests. Evaluate each expected validation, emit a benchmark verdict, return a distinct failure code for unmet expectations, and store the definition hash for reproducibility.

### 6. SDK sessions do not produce the full evaluation slice

Where: `packages/sdk/src/index.ts` records events and completes sessions but does not collect Git boundaries, validations, or save scores.

Add either a high-level SDK orchestrator that mirrors CLI completion, or a documented contract where the host records validations/outcomes and calls `evaluateSession()`. Protect completion against duplicate calls and add an abandoned-session recovery policy.

### 7. Rework and attribution inputs are partially dead

Where: `EvaluationInput` includes `failedCommands`, `commandCount`, and `filesCreatedThenDeleted`, but current scoring does not use all of them. Recalculation and initial evaluation can therefore diverge in available inputs.

Remove unused inputs or incorporate them into a versioned, tested formula. Store scoring algorithm version with every snapshot.

### 8. Validation parsing needs stronger evidence

Where: `packages/collectors/src/index.ts`.

Human-readable Vitest/TypeScript parsing is necessarily fragile. JUnit is parsed with regular expressions, which will fail on valid XML edge cases. `coveragePercent` exists but is never populated.

Production direction:

- Prefer machine-readable result files.
- Use a real XML parser for JUnit with file size/entity protections.
- Add fixtures for Jest, Vitest, ESLint, TypeScript, monorepo output, color codes, truncation, Windows paths, timeout, spawn error, and malformed output.
- Track parser name and version in stored details.
- Separate “command passed” from “details parsed successfully.”

### 9. File-change counts can overstate distinct files

Where: `apps/cli/src/report.ts` counts `file.changed` events; schemas allow occurrences but aggregation is not a first-class distinct-file projection.

Store canonical normalized relative paths and distinguish event count, unique file count, and rename pairs. Preserve case-sensitivity semantics by platform.

## AI assessment and implemented enhancement

### Existing narrative analysis

The OpenRouter implementation uses temperature zero, strict structured output, bounded output tokens, timeout, Zod validation, evidence hashing, and a narrative-only authority label. That is a good architecture.

This audit added two accuracy/privacy improvements:

1. AI anomaly citations are rejected if they do not reference a real ID in the transmitted bundle.
2. Free-form commands, errors, reasons, evidence text, sources, rationales, and validation limitations are excluded from outbound report analysis. Validation details are now an explicit numeric/status allowlist.

### New AI task profiling

`tokenfaxx run --ai-profile --task "..."` now performs opt-in, description-only structured classification through OpenRouter.

Rules:

- The CLI prints an outbound-data notice before the request.
- Source, diffs, repository paths, terminal output, and environment values are not sent.
- Explicit user type/complexity wins.
- AI complexity only participates in scoring at confidence 70 or greater.
- Low-confidence results preserve `unknown` complexity.
- Model, generation ID, rationale, confidence, missing evidence, tags, token usage, and cost are stored with the profile, separately from agent usage.
- Provider failure falls back to deterministic inputs and does not block the coding session.

This is useful, but “confidence” is model self-assessment until calibrated. Before calling it accurate, create a labeled task set reviewed by multiple engineers and measure classification agreement, confusion by task type, and complexity calibration.

### Next AI features worth building

Priority order:

1. Evidence completeness assistant: identify which deterministic evidence is missing before a run and generate a setup checklist.
2. Validation recommendation assistant: inspect only manifest/script metadata and propose commands for user approval; never auto-execute AI-generated commands.
3. Failure clustering: embed sanitized error fingerprints locally or with opt-in cloud processing to group recurring infrastructure failures.
4. Review summary grounding: summarize PR/CI/review evidence only after GitHub enrichment exists.
5. Natural-language report Q&A using retrieval over structured local reports, with citations to event IDs.

Do not build autonomous score adjustment, AI correctness verdicts, developer ranking, or inferred acceptance.

## Product usability gaps

### CLI

- Split the 1,000-line CLI module into command handlers and application services.
- Validate enum/format options through Commander rather than silently falling back.
- Make `doctor` return non-zero when required checks fail and support `--json` for automation.
- Add `--quiet`, stable machine-readable error codes, and shell completion.
- Add session tags, notes, pagination, date filters, and project filters.
- Add import/backup/restore with schema compatibility checks.
- Detect and finalize stale `running` sessions after host crashes.

### Reports

- Add trend reports by benchmark/task/model/agent and confidence bands.
- Show task profile source/confidence in terminal output.
- Expose analysis-specific cost separately.
- Add an HTML static report before building a full web app.
- Version the JSON/CSV export schemas.
- Include units and null semantics in a machine-readable data dictionary.

### Team product

A full hosted product needs:

- Organizations, users, projects, environments, and RBAC.
- Encrypted ingestion with per-project keys and idempotency IDs.
- Postgres/object storage, background jobs, retention/deletion workflows, and regional controls.
- Immutable organization audit log.
- Dashboard, saved views, benchmarks, alerts, and shareable reports.
- Billing/quotas that distinguish agent usage from TokenFaxx analysis usage.
- SSO/SAML, SCIM, data-processing terms, subprocessors, and enterprise retention.

Do not start here until local evidence accuracy and a clear buyer/use case are validated.

## Architecture and maintainability gaps

### Database migrations

Where: `packages/storage/src/database.ts` contains a single SQL bootstrap plus runtime `ensureColumn` calls.

Replace this with ordered immutable migration files, checksums, transactional application, rollback/backup guidance, and migration tests from every supported prior version. Add `schema_version` to exported data.

### Atomicity

Status: implemented on 2026-08-18.

`appendEvent` now validates session context, writes the immutable event and normalized projection in one SQLite transaction, treats identical event-ID retries as no-ops, and rejects conflicting ID reuse. Tests force a projection failure and verify that the event is rolled back. The next storage step is replacing the embedded migration bootstrap with ordered immutable migrations and adding idempotency keys to future remote ingestion endpoints.

### Module boundaries

Move orchestration out of `apps/cli/src/index.ts` into services such as `SessionRunner`, `ReportService`, `BenchmarkRunner`, and small command adapters. Keep storage, network, clock, process, and filesystem behind injectable interfaces where tests benefit; do not create abstractions for pure functions.

### Observability

- Add structured error codes and operation durations.
- Keep local logs opt-in and redact them.
- Record collector/parser/adapter versions.
- Add counters for dropped/truncated output and failed projections.
- Provide a diagnostic bundle that excludes sensitive content.

## Security and privacy gaps

1. Write a formal threat model covering malicious repositories, commands, result files, symlinks, exported data, SQLite tampering, and prompt injection in task metadata.
2. Treat `tokenfaxx.config.ts` as executable code and state this clearly; offer a JSON configuration option for untrusted environments.
3. Validation and custom commands use a shell. Keep explicit opt-in, display exact commands, and consider a no-shell argv form.
4. Constrain `resultFile` to the repository or require an explicit override; reject symlink escapes for safer defaults.
5. Add property/fuzz tests for secret redaction and outbound sanitization.
6. Add dependency review, lockfile auditing, provenance/SBOM, signed releases, and a security policy.
7. Add database integrity checks and safe backup before migration.
8. Do not claim the local `maxCostUsd` is a pre-spend hard limit; it is checked after the provider responds.

## Reliability and scaling

SQLite is appropriate for a local single-user CLI. Keep it until concurrent writers or remote teams are real requirements.

Local reliability work:

- Add busy timeout and retry policy for concurrent SDK writers.
- Test WAL recovery, disk full, corrupt DB, permission errors, and abrupt termination.
- Make session finalization idempotent.
- Cap event/session growth and add vacuum/maintenance guidance.
- Stream exports instead of loading all bundles for large databases.
- Avoid one query per session during bulk export.

Hosted scaling later:

- Idempotent ingestion API -> durable queue -> validation/projection workers -> Postgres analytics tables/object storage.
- Partition by organization/project/time.
- Separate raw immutable events from rebuildable projections.
- Apply backpressure and per-tenant quotas.
- Use asynchronous analysis jobs with retry/dead-letter policy and spend controls.

## Testing gaps

Current tests cover selected schemas, scoring invariants, storage cascade/analysis separation, parsing cases, CSV nulls, and interruption. That is a good start but too small for production.

Required suites:

- End-to-end CLI tests for every command and exit code.
- Golden report/export schema fixtures.
- Adapter fixtures and compatibility matrix.
- Database migration and crash-recovery tests.
- Git edge cases: unborn branch, detached HEAD, rename, staged/unstaged overlap, submodule, worktree, large repo.
- Validation parser fixture corpus and fuzz tests.
- AI structured-output refusal, malformed JSON, timeout, HTTP error, over-budget, unknown citations, prompt-injection strings, and privacy snapshots.
- Cross-platform Node 20/22 tests on Linux, macOS, and Windows.
- Benchmark reproducibility and unmet-expected-outcome tests.
- Performance tests for 10k+ sessions and large event streams.

## Delivery and governance missing from the repository

- No CI workflow.
- No license.
- No contribution guide, code of conduct, security policy, changelog, or release process.
- No npm publishing/provenance setup.
- No dependency-update or vulnerability-management automation.
- No compatibility/support matrix.
- No product analytics or opt-in feedback mechanism.

These are release blockers for a public product, not cosmetic tasks.

## Prioritized roadmap

### P0: trustworthy developer preview

1. Wire documented exact usage channels for Codex/Claude CLI adapters; configured SDK pricing is complete.
2. Evaluate benchmark `expectedOutcome` and definition hashes.
3. Replace the embedded migration bootstrap; transactional/idempotent event projection is complete.
4. Add stale-session recovery and idempotent completion.
5. Constrain result files and complete privacy/security regression tests.
6. Add CI across supported OS/Node versions and require typecheck/test/build.
7. Add a license, security policy, changelog, and reproducible release process.
8. Expand end-to-end tests and publish an explicit JSON report schema.

Exit gate: repeated benchmark runs are reproducible; no known silent data corruption; privacy snapshots prove outbound fields; installation works from a clean machine.

### P1: accurate individual/team pilot

1. GitHub PR/CI/review enrichment.
2. Adapter event side channel and official provider integrations.
3. Calibrated, versioned benchmark cohorts.
4. Static HTML/trend reports and evidence-completeness guidance.
5. Plugin discovery/versioning with signed manifests.
6. Backup/restore and large-dataset export performance.

Exit gate: pilot users can explain every score component and trace it to evidence; comparisons are limited to defensible cohorts.

### P2: hosted team product

1. Organizations/RBAC/project ingestion.
2. Secure cloud event pipeline and background analysis.
3. Team dashboards, saved comparisons, alerts, and audit logs.
4. SSO/SCIM, billing, retention, deletion, and compliance foundations.
5. Multi-provider AI with data-residency and zero-retention controls.

Exit gate: tenant isolation, deletion, auditability, SLOs, incident response, and cost controls are independently tested.

### P3: ecosystem and intelligence

1. Public adapter/collector SDK and compatibility certification.
2. Locally hosted model option for sensitive environments.
3. Evidence-grounded report Q&A and failure clustering.
4. Organization-specific calibrated baselines with minimum cohort/privacy thresholds.

## Recommended next implementation sequence

For the next engineering sessions, do this in order:

1. Make benchmark expectations produce a stored verdict and failing exit code.
2. Add stale-session recovery to `doctor` with an explicit `--repair` action.
3. Create CI and clean-install smoke tests.
4. Replace the embedded migration bootstrap with ordered migration files.
5. Only then start GitHub enrichment.

This sequence improves evidence correctness and operational safety before adding more surface area.

## Definition of “accurate” for TokenFaxx

TokenFaxx should claim accuracy only when:

- Observed facts identify their source and timestamp.
- Provider values come from documented provider responses.
- Calculated values identify formula and pricing/baseline version.
- Inferred values identify model/rules, confidence, limitations, and inputs.
- Missing values remain missing.
- Outcomes distinguish execution, validation, review, merge, acceptance, and later regression.
- Comparisons use equivalent tasks and starting states or clearly refuse a winner.
- Every AI factual anomaly cites transmitted evidence that exists.
- A user can reconstruct why a report said what it said without trusting a hidden model.

That definition—not adding AI everywhere—is what can turn TokenFaxx into a trustworthy product.
