# Changelog

All notable changes to TokenFaxx are documented here. This project follows semantic versioning while its public interfaces stabilize.

## [0.1.0] - 2026-08-24

### Added

- Local-first coding-agent session tracking backed by SQLite.
- Codex, Claude, structured JSON telemetry, custom command, and SDK adapters.
- Git metadata collection, validation runners, deterministic scoring, confidence, reports, exports, comparisons, and benchmark worktrees.
- Provider-reported Codex and Claude usage normalization.
- Session heartbeats, stale-session diagnosis, and explicit recovery.
- Optional sanitized OpenRouter task profiling and narrative analysis.

### Fixed

- Preserve every provider argument after `--`, including a single Codex or Claude prompt.
- Treat explicit structured provider failures as failures even when the provider exits zero.
- Avoid claiming mutating tasks completed when no Git change evidence exists.
- Exclude TokenFaxx's own local database files from Git attribution evidence.
- Enforce agent deadlines and persist benchmark setup failures.
- Make custom benchmark invocation mutually exclusive and check out the exact resolved commit.
- Generate standalone configuration that does not import unpublished workspace packages.

### Security

- Privacy-safe storage defaults and credential-like child-environment filtering.
- Path-containment checks for machine-readable validation result files.

### Known limitations

- The CLI and configuration surface are alpha and may change before 1.0.
- Hosted collaboration, CI enrichment, and statistical benchmark cohorts are not included.
