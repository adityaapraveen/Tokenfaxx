# Versioned event schema

TokenFaxx currently writes schema version `1`. Every event has a UUID event ID and session ID, ISO timestamp, agent, repository path, optional task ID, discriminated event type, validated payload, and metadata object. `@tokenfaxx/core` validates the envelope and the payload together before storage.

Supported types are `session.started`, `session.completed`, `model.usage`, `tool.started`, `tool.completed`, `file.changed`, `command.completed`, validation-specific completion events, `git.commit.created`, `validation.completed`, `task.outcome`, and `error`.

Evidence-rich sessions also use `git.sampled`, `task.profiled`, and `analysis.completed`. Git samples contain filenames/status/size/timestamps only. Task profiles may include bounded AI inference provenance, confidence, limitations, and analysis-specific usage. Analysis events contain the sanitized evidence hash, structured narrative, model identity and analysis-specific usage.

Schema changes that break interpretation require a new integer version and a migration/upcaster. Unknown or malformed payloads are rejected; they are never silently retained as opaque JSON.
