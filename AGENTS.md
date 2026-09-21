# AGENTS.md

## Project Overview

`redmine-client` is a VS Code extension for managing Redmine 6.1 issues, comments, Markdown editing, Dashboard interactions, and offline synchronization.

- **Stack**: TypeScript 5.9 (strict mode), VS Code ^1.107.0, webpack 5, @vscode/test-cli + Mocha, ESLint 9. Entry point: `src/extension.ts`.
- **Language Policy**: Write responses, review comments, and documentation in Japanese. Preserve commands, API names, identifiers, and source notation as-is.
- **Authority**:
  - Architecture & Persistence Decisions: `docs/implementation-decisions/`
  - Planning & Specs: `docs/planning/`
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
npm run compile
npm run lint

# Webpack Build
npm run build

# Unit / Integration Tests
npm test

# Focused Unit Test
npx mocha out/test/unit/<path-to-test>.js

# Extension Host Tests (when VS Code runtime integration is affected)
npm run test:extension
```