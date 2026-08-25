# Releasing TokenFaxx

## Preconditions

- The release commit is merged into `main`.
- `apps/cli/package.json` contains the intended semantic version.
- `CHANGELOG.md` contains that version.
- The publisher has npm 2FA enabled and access to the unscoped `tokenfaxx` package.
- The `npm` GitHub environment has appropriate protection rules.
- For token-based publication, the repository has an `NPM_TOKEN` secret. After the first release, configure npm trusted publishing for `.github/workflows/release.yml` and remove the long-lived token when possible.

## Local verification

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm --filter tokenfaxx package:check
pnpm audit --prod --audit-level high
npm view tokenfaxx version
npm whoami
```

`package:check` runs `npm pack`, installs the exact tarball into a clean temporary project with lifecycle scripts enabled, checks the installed CLI version, initializes a Git repository, loads the generated standalone configuration, and runs `doctor`.

## First publication

The first publication may be performed locally after reviewing the packed artifact and authenticating through npm's normal login flow:

```bash
npm login
npm publish ./apps/cli/dist --access public --provenance
npm view tokenfaxx name version dist-tags --json
```

Do not publish from an uncommitted working tree. Never place an npm token in source, shell history, logs, or TokenFaxx configuration.

## Automated releases

1. Update the version and changelog in a pull request.
2. Merge only after CI passes on Node 20/22 and package smoke tests pass on Linux, macOS, and Windows.
3. Create a GitHub release whose tag exactly matches `v<package-version>`.
4. The release workflow rebuilds, tests, clean-installs, and publishes with npm provenance.
5. Verify the public package from a clean environment:

```bash
npm view tokenfaxx version
npx --yes tokenfaxx@latest --version
```

If publication fails, do not reuse a version already accepted by npm. Diagnose the failure, increment the version when required, and repeat the release process.
