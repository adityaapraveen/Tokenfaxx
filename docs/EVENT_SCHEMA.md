# Versioned event schema

TokenFaxx currently writes schema version `1`. Every event has a UUID event ID and session ID, ISO timestamp, agent, repository path, optional task ID, discriminated event type, validated payload, and metadata object. `@tokenfaxx/core` validates the envelope and the payload together before storage.

Supported types are `session.started`, `session.completed`, `model.usage`, `tool.started`, `tool.completed`, `file.changed`, `command.completed`, validation-specific completion events, `git.commit.created`, `validation.completed`, `task.outcome`, and `error`.

Model usage keeps token measurement provenance separate from cost provenance. Configured prices may fill a missing cost only when provider/model/token fields match; calculated cost stores its source and pricing effective date. Provider-supplied costs are never overwritten.

Evidence-rich sessions also use `git.sampled`, `task.profiled`, and `analysis.completed`. Git samples contain filenames/status/size/timestamps only. Task profiles may include bounded AI inference provenance, confidence, limitations, and analysis-specific usage. Analysis events contain the sanitized evidence hash, structured narrative, model identity and analysis-specific usage.

Schema changes that break interpretation require a new integer version and a migration/upcaster. Unknown or malformed payloads are rejected; they are never silently retained as opaque JSON.

## Delivery guarantees

Appending an event and writing its normalized projection occur in one SQLite transaction. A projection failure rolls the event back, so raw events and query tables cannot silently diverge.

Event IDs are idempotency keys:

- Retrying the same validated event ID and content is a no-op and returns the original logical event.
- Reusing an event ID with different session, schema, type, timestamp, payload, or metadata is rejected with `EVENT_ID_CONFLICT`.
- Event agent, repository, and task context must match the owning session or the append is rejected with `EVENT_SESSION_MISMATCH`.

Payload and metadata objects are canonicalized before comparison, so object key ordering does not turn an otherwise identical retry into a conflict. Producers should retain the original event ID and timestamp when retrying delivery.
