# Benchmark evaluation

TokenFaxx benchmarks answer a narrow, auditable question: did an agent starting from a known Git commit produce the validation outcomes declared by this benchmark?

They do not ask an LLM whether the implementation “looks correct.” Agent execution, Git boundaries, validation processes, and expected outcomes remain deterministic evidence. Optional AI analysis may explain that evidence later, but it cannot change the verdict.

## Definition

```json
{
  "id": "fix-notification-migration",
  "description": "Fix the failing notification settings migration",
  "repository": ".",
  "startingCommit": "HEAD",
  "timeoutMs": 900000,
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

At least one of `testsPass`, `buildPasses`, `lintPasses`, or `typecheckPasses` is required. Each declared validation command must have its matching expectation, and each expectation must have its matching command. Unknown keys are rejected so a typo or un-gated validation cannot silently weaken a benchmark.

An expectation set to `false` means failure is the expected observation. A skipped, absent, or unrecognized validation remains `missing`; it does not satisfy either `true` or `false`.

## Lifecycle and reproducibility

1. TokenFaxx requires the primary repository to be clean.
2. `startingCommit` is resolved to an immutable Git commit.
3. The normalized definition, resolved commit, and hash-format version are hashed with SHA-256.
4. A detached temporary worktree is created at that commit.
5. The agent command and declared validation commands run inside the worktree.
6. Each expectation is classified as `met`, `unmet`, or `missing` from stored validation evidence.
7. The complete verdict is stored as a versioned `benchmark.evaluated` event.
8. Successful worktrees are removed. Failed worktrees are preserved for debugging.

The definition hash changes when a meaningful definition field or the resolved starting commit changes. Formatting and JSON object-key ordering do not change it. The printed `sha256-v1` prefix makes the canonicalization contract explicit. Validation commands come only from this hashed benchmark definition; commands in `tokenfaxx.config.ts` are not inherited into benchmark runs.

## Run it

From a clean Git repository:

```bash
tokenfaxx benchmark run \
  --task examples/benchmark.json \
  --agent codex
```

To evaluate any reviewed local command instead of an installed agent CLI:

```bash
tokenfaxx benchmark run \
  --task examples/benchmark.json \
  --agent custom \
  --command "node ./my-agent.js"
```

Inspect the stored verdict later:

```bash
tokenfaxx report --format json
tokenfaxx benchmark compare --benchmark fix-notification-migration
```

Session comparison requires matching benchmark definition hashes and starting commits for maximum confidence. Reusing an ID with changed commands or expectations does not make two runs equivalent, and TokenFaxx will not declare a winner for that benchmark mismatch.

## Exit codes

| Code      | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `0`       | Agent command succeeded and every declared expectation was met.            |
| `2`       | At least one declared expectation was unmet or lacked validation evidence. |
| `130`     | The session was interrupted.                                               |
| Other `N` | The agent command exited `N` while benchmark expectations otherwise met.   |

This makes the command safe to use as a CI gate:

```bash
tokenfaxx benchmark run --task examples/benchmark.json --agent codex
```

No extra API key is required for deterministic benchmark evaluation. `OPENROUTER_API_KEY` is only needed when `--ai-profile` or OpenRouter narrative analysis is enabled.

## Local product smoke test

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm --filter tokenfaxx link --global
tokenfaxx doctor
tokenfaxx benchmark run --task examples/benchmark.json --agent codex
tokenfaxx report --format terminal
```

Before using the example against a real repository, replace its task, starting commit, and validation commands with inputs you have reviewed. Benchmark and validation commands execute with your user permissions.
