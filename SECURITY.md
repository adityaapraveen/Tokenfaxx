# Security Policy

## Supported versions

TokenFaxx is currently an alpha release. Security fixes are provided for the latest published version only.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps, impact, and any suggested mitigation.

You should receive an acknowledgement within 72 hours. We will validate the report, coordinate a fix and disclosure timeline, and publish a security advisory when appropriate.

## Trust boundaries

TokenFaxx runs coding agents, validation commands, benchmark setup commands, and executable TypeScript configuration with the current user's permissions. Use it only in repositories and with commands you trust. TokenFaxx reduces accidental data collection; it is not a sandbox for hostile repositories or commands.

Prompts, responses, terminal output, source text, diff contents, environment values, and credentials are not intentionally stored by default. Repository paths, filenames, task descriptions, validation commands, outcome reasons, and other metadata can still be sensitive. Inspect exports before sharing them.
