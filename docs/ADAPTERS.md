# Adapter development

Implement `AgentAdapter` from `@tokenfaxx/adapters` with a stable name/version, installation detection, launch specification, and honest capability flags. Adapters launch agents; they do not write storage or calculate scores. Registering another adapter is currently a one-line addition to the adapter registry.

Codex and Claude are wrapped through their documented executable behavior. The `codex` and `claude` adapters preserve interactive mode and do not claim exact token, model, tool-event, or cost data. The opt-in `codex-json` and `claude-json` adapters use official non-interactive structured output (`codex exec --json` and `claude -p --verbose --output-format stream-json`) to record provider-reported model, token, and available cost fields without storing raw output. Structured parsing is defensive: malformed and unknown events are ignored, cumulative Codex snapshots replace earlier snapshots, and repeated Claude assistant messages are deduplicated by message ID. The generic adapter launches an explicitly supplied shell command. SDK-instrumented agents can report exact or provider-reported measurements through `@tokenfaxx/sdk`.

Never parse decorative terminal output as a reliable usage API. If a provider later offers a documented machine-readable callback, add it as an optional capability and retain the source/measurement classification.
