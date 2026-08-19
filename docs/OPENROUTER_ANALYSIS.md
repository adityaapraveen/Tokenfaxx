# Optional OpenRouter analysis

TokenFaxx reports are deterministic by default. OpenRouter is an opt-in narrative analyst: it summarizes sanitized evidence, identifies evidence-linked anomalies, lists missing information, and suggests next steps. It cannot change measurements, task outcomes, attribution, or scores.

OpenRouter also supports opt-in task profiling:

```bash
export OPENROUTER_API_KEY="..."
tokenfaxx run --agent codex --task "Fix cache invalidation" --ai-profile
```

Task profiling sends the task description. Explicit user type/complexity wins, and an inferred complexity is used only at confidence 70 or above. The inference model, rationale, limitations, usage, and cost are retained separately from coding-agent usage.

Enable it in `tokenfaxx.config.ts` and supply the key only through the environment:

```ts
analysis: {
  enabled: true,
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  timeoutMs: 30_000,
  maxCostUsd: 0.05,
  sendSourceCode: false,
  sendDiffContents: false,
  sendPrompts: false
}
```

```bash
export OPENROUTER_API_KEY="..."
tokenfaxx report --analysis openrouter
tokenfaxx report --analysis openrouter --refresh-analysis
```

Before report-analysis transmission, repository paths and task descriptions are removed and filenames are replaced by session-local aliases. Free-form commands, errors, outcome reasons/evidence, parser limitations, and source strings are excluded. Source, diffs, prompts, responses, terminal output, environment values and secrets are never included. Validation data is restricted to an explicit status/numeric allowlist. The structured response, requested/actual model, generation ID, evidence SHA-256, schema version, usage and reported cost are stored locally. AI anomaly citations are rejected unless every cited ID belongs to an actual transmitted event; session and validation-row IDs cannot satisfy an event citation. Stored benchmark verdicts are deterministic authority that AI may explain but cannot replace.

Enabling analysis or `--ai-profile` creates an explicit outbound network request to OpenRouter and its routed provider; review their policies before enabling it. `maxCostUsd` is checked against cost reported after completion and is not a provider-side pre-spend guarantee.
