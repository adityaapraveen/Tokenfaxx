# Adapter development

Implement `AgentAdapter` from `@tokenfaxx/adapters` with a stable name/version, installation detection, launch specification, and honest capability flags. Adapters launch agents; they do not write storage or calculate scores. Registering another adapter is currently a one-line addition to the adapter registry.

Codex and Claude are wrapped through their documented executable behavior. Their CLI adapters support interactive mode but do not claim exact token, model, tool-event, or cost data. The generic adapter launches an explicitly supplied shell command. SDK-instrumented agents can report exact or provider-reported measurements through `@tokenfaxx/sdk`.

Never parse decorative terminal output as a reliable usage API. If a provider later offers a documented machine-readable callback, add it as an optional capability and retain the source/measurement classification.
