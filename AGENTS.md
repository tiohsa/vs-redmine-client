# AGENTS.md

## Project Overview

`redmine-client` is a VS Code extension for managing Redmine 6.1 issues, comments, Markdown editing, Dashboard interactions, and offline synchronization.

- **Stack**: TypeScript 5.9 (strict mode), VS Code ^1.107.0, webpack 5, @vscode/test-cli + Mocha, ESLint 9. Entry point: `src/extension.ts`.
- **Language Policy**: Keep `AGENTS.md` in English. Write responses, review comments, and other documentation in Japanese. Preserve commands, API names, identifiers, and source notation as-is.
- **Authority**:
  - Use [docs/README.md](docs/README.md) to find the authoritative specifications for features, architecture, and persistence.
  - When changing behavior, update the authoritative feature specification and its related tests in the same change.
  - Dashboard UI / Visual: Local `DESIGN.md` (takes precedence for visual decisions; otherwise preserve existing conventions)
- **Artifacts**: Do not edit `dist/` or `out/` directly. Regenerate via standard build scripts.

## Critical Project Invariants

Follow these repository-specific invariants without deviation:
    
- **Dashboard Boundary**: Treat Webview messages as untrusted input. Validate all payloads through `dashboardProtocol.ts` and `dashboardMessageValidation.ts` before passing them to controllers, services, or application logic.
- **Credentials & Network Isolation**:
  - API keys must reside in VS Code `SecretStorage` keyed by normalized `connectionScope` hash.
  - Never reuse, leak, or inherit credentials across scopes.
  - Insecure HTTP is permitted only for loopback hosts (`localhost`, `127.0.0.1`, `::1`). Reject all other insecure HTTP endpoints before sending credentials.
  - Use `vscode.l10n.t` for user-facing strings.
- **Scope & Offline Persistence**:
  - Drafts, queues, operations, and persistent effects must remain strictly isolated by `connectionScope`.
  - In `src/views/offlineSyncStore.ts`, state mutations must occur inside scope transaction boundaries, read snapshots within that boundary, and persist state before exposing it in memory.
  - Preserve backward compatibility and migration paths for schema, keying, revision, and attempt generation.
- **Synchronization Lifecycle & Atomic Transitions**:
  - Remote writes must adhere to the lifecycle order in `src/app/syncEngine.ts` and `src/app/ticketSync/`: remote write -> read-back / reconciliation -> local finalization. Never bypass this flow.
  - Primary Operation phase and Primary Effect state must transition atomically via `SyncOperationRepository.transitionPrimaryRemoteWrite`. Ledgers must not diverge.
- **Generations, Compensation & Unknown Remote Outcomes**:
  - Callbacks, retries, and finalizations from an obsolete `revision` or `attemptGeneration` must not modify active operations. Reject stale work without persistence writes.
  - Planned Effects are monotonic and idempotent. Do not move an Effect from non-planned back to planned unless handling an explicit compensation flow.
  - Never automatically retry `commit_unknown` or non-retryable failures. Re-try explicitly only by reusing the frozen `RequestSnapshot`.
- **Attachment Identity**: Freeze remote-write identity (`contentHash`, `contentSize`, `spoolFilePath`) before writes begin. It must survive retries and VS Code restarts without regenerating IDs.

## Autonomous Scope & Definition of Done

- **Autonomous Execution**:
  - You have permission to implement changes, run targeted validation suites, fix regressions caused by your modifications, and iterate until green without seeking user confirmation at each intermediate step.
- **Scope Discipline**:
  - Make the smallest coherent change that satisfies the request.
  - Keep one responsibility per source file. When creating or changing files, group code that changes for the same reason. Put independently changing concerns, such as input validation, business decisions, persistence, and presentation, in separate files.
  - Limit each file to one top-level implementation class. Put additional implementation classes in separate files. The architecture gate enforces this limit.
  - Do not introduce unrelated refactoring, new dependencies, or weaken TypeScript strictness (`any`, broad type assertions, disabled checks).
  - Do not silently broaden destructive behavior (discard, force-sync, compensation, migration).
- **Definition of Done**:
  A task is complete when:
  1. The requested change is implemented while preserving all architectural boundaries and synchronization invariants.
  2. Targeted validations (compile, lint, affected unit/integration/Extension Host tests) pass cleanly.
  3. If Electron/Chromium sandbox restrictions block Extension Host tests, state the blocker and remaining unverified risks explicitly.
  4. The final report (in Japanese) succinctly outlines modified files, key architectural decisions, and executed checks.

## Essential Verification Commands

Run only the checks relevant to your change:

```bash
# Type Check & Lint
pnpm exec tsc --noEmit
pnpm run lint

# Test Compilation / Webpack Build
pnpm run compile-tests
pnpm run compile

# Extension Host Tests
pnpm test

# Dashboard UI
pnpm run test:dashboard-ui
```

## Feature Verification

- Before adding a test, identify the specific regression to detect and the observable result. Confirm that the test fails when you deliberately break the relevant implementation. Update an existing test when it already verifies the same conditions and outcome.
- Use dedicated runners to select tests that require an external environment. Lint detects empty tests, early returns that make verification unreachable, comparisons of constants or a value with itself, and uses of `skip`, `only`, or `todo` inside tests.

- Place new features in `src/layers/<runtime>/features/<id>/` and expose their public API through `index.ts`. See `src/layers/extension-host/features/reference-example/` for an implementation example.
- When adding commands or views, update `entryPoints` in `verification/feature-map.json`. When a change affects how users operate a major feature, also update the corresponding entry points, existing selectors, verification conditions, and tests in or referenced by `features`.
- Run `pnpm run verify:all` to check the static gates and the Extension Host reference scenario. On headless Linux, use `xvfb-run -a pnpm run verify:all`.
- When resolving existing violations, run `node scripts/check-architecture.cjs --record-legacy` to reduce their counts in the baseline. The update fails if new violations exist. Baseline changes require code owner review.
