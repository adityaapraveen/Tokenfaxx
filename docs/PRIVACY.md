# Privacy and security model

TokenFaxx has no telemetry and is local-only by default. It stores session metadata, repository paths, filenames, Git SHAs, counts, durations, exit codes, validation outcomes, and explicitly reported usage. By default it never stores prompts, model responses, terminal output, source or diff contents, environment values, API keys, or authentication material.

Optional OpenRouter analysis is the only outbound feature. It is disabled by default and sends a sanitized metadata bundle only after explicit configuration. Repository paths, task descriptions, commands, errors, outcome reasons, source strings, and parser limitations are omitted from report analysis; filenames are aliased and validation details use an explicit allowlist. The API key is read from `OPENROUTER_API_KEY` and is never stored.

`tokenfaxx run --ai-profile` is a separate per-run opt-in that sends the supplied task description to OpenRouter. It does not send source, diffs, repository paths, terminal output, or environment values. The CLI prints a notice before transmission.

Structured SDK metadata is recursively redacted when keys resemble credentials. This is defense in depth, not permission to send secrets. `.tokenfaxx` is created with owner-only directory permissions where supported, and the SQLite file is hardened to mode `0600`. Use `delete-session`, `delete-all-data --yes`, exports, and configured retention to manage local data.

Filenames and repository paths can themselves be sensitive. Keep exports private and inspect them before sharing.
