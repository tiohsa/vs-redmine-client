# redmine-client AGENTS Guide

Last updated: 2026-08-14

## 1. Project Overview

* `redmine-client` is a VS Code extension for managing Redmine 6.1 issues, comments, Markdown editing, and offline synchronization from a single Dashboard Webview.
* Responses, documentation, and review comments must be written in Japanese. Preserve the original notation for commands, API names, and identifiers.
* The technical baseline is TypeScript 5.9, VS Code `^1.107.0`, webpack 5, `@vscode/test-cli` + Mocha, and ESLint 9.
* The extension runs in the Node.js Extension Host and is activated from `src/extension.ts`. Keep TypeScript `strict` mode enabled.

## 2. Repository Structure and Responsibilities

* `src/extension.ts`: The composition root that wires together store initialization, views, synchronization, commands, and editor events.
* `src/app/`: Application layer. Responsible for command/view registration, save classification, notifications, and synchronization orchestration (`SyncEngine`).
* `src/app/ticketSync/`: Owns generic synchronization state machine, operation handlers, repository interfaces, reconciliation, and finalization after remote writes. Do not bypass this boundary when adding new write paths.
* `src/dashboard/`: Owns the Dashboard protocol, input validation, router, controller, state store, services, view models, HTML, CSS, and scripts.
* `src/commands/`: Thin command handlers invoked from the Command Palette and Dashboard. Do not duplicate shared synchronization logic here.
* `src/views/`: Responsible for the Markdown editor, drafts, persisted unsynced queue, conflict resolution, and presentation adapters. `src/views/ticketSync/` is the integration boundary between the editor/queue and the application layer.
* `src/redmine/`: Responsible for the Redmine HTTP API, authentication, and types and operations for projects/issues/comments/users/attachments.
* `src/config/`: Responsible for VS Code configuration, connection scope, project selection, and API key management through SecretStorage.
* `src/utils/`: Contains functionality that does not belong to a specific UI, such as URL handling, notifications, images, Mermaid conversion, and three-way merge.
* `src/test/`: Extension Host tests. Shared stubs/fixtures belong in `src/test/helpers/`.
* `docs/planning/`, `docs/implementation-decisions/`, `docs/review/`: When present, use these directories separately for plans, implementation decisions, and review results.
* `l10n/`, `package.nls.json`, `package.nls.ja.json`: Localization assets for UI strings and the extension manifest.
* `dist/` and `out/` are generated artifacts. Do not edit them directly; regenerate them through webpack and TypeScript compilation respectively.

## 3. Development Commands

* `pnpm install`: Install dependencies according to `pnpm-lock.yaml`.
* `pnpm run compile`: Build `src/extension.ts` into `dist/extension.js` for development.
* `pnpm run watch`: Run webpack in watch mode.
* `pnpm run package`: Generate the production bundle for publishing.
* `pnpm run compile-tests`: Remove `out/test/`, then compile all TypeScript into `out/`.
* `pnpm run lint`: Run `eslint src`.
* `pnpm test`: Run all Extension Host tests after `compile-tests`, `compile`, and `lint`.
* `pnpm run test:unsafe`: Alternative test path for sandbox-restricted environments. Use only when the normal `pnpm test` fails due to sandbox restrictions.

## 4. Implementation Conventions

* Assume `strict` mode from `tsconfig.json`. Do not work around problems with `any`, unnecessary type assertions, or disabled type checking.
* Follow the naming, `curly`, `eqeqeq`, `no-throw-literal`, and semicolon rules defined in `eslint.config.mjs`.
* Reuse existing module boundaries and helpers. Do not mix in large-scale refactoring or new dependencies that are outside the requested scope.
* Validate values received from the Dashboard at the `dashboardProtocol.ts` and `dashboardMessageValidation.ts` boundaries. Do not pass unvalidated Webview messages to controllers.
* Use `vscode.l10n.t` for user-facing strings. When adding or changing strings, also update the corresponding `l10n/bundle.l10n*.json` or `package.nls*.json`.
* Before modifying the Dashboard UI, check for a local `DESIGN.md` and treat it as the SSoT if it exists. This file is not tracked by git; if it does not exist, do not guess design values and ask the user instead.
* API keys must be handled only through VS Code SecretStorage. Never write real values into settings, logs, fixtures, or documentation. Limit `ignoreSSLErrors` to development and verification use cases.

## 5. Synchronization and Persistence Invariants

* Data in `src/views/offlineSyncStore.ts` is persistent state that survives VS Code restarts. When changing its shape, key, scope, revision, or phase, verify restoration of existing data and legacy compatibility.
* Synchronization must go through the lifecycle defined by `src/app/syncEngine.ts` and `src/app/ticketSync/`, preserving the ordering and checkpoints of remote write, read-back, and local finalize.
* Primary Operation phase and Primary Effect state must transition atomically via `SyncOperationRepository.transitionPrimaryRemoteWrite` in a single persistence call to prevent state ledger divergence.
* Planned effects are monotonic and idempotent; non-planned effects (committed/started/failed/commit_unknown) must never be rolled back to `planned` on re-planning unless explicitly compensated.
* Do not automatically retry a remote write when its outcome is unknown (`commit_unknown`) or known non-retryable failure. Explicit retry on the same revision must reuse the frozen API-ready `RequestSnapshot`.
* File and Clipboard attachment bytes identity (contentHash, contentSize, spoolFilePath) must be frozen prior to remote write to guarantee idempotency across restarts and retries.
* Do not apply persistent effects while ignoring the revision fence or operation scope. When switching connections, do not mix drafts or queues from different Redmine environments.
* When changing discard behavior for queue entries, force sync, migration, or remote-write retry conditions, describe the destructive impact and recovery method first.

## 6. Testing and Verification

* When changing behavior, add or update the corresponding `src/test/*.test.ts`. For synchronization changes, verify not only the normal path but also conflicts, partial failures, restart restoration, revision mismatches, and remote writes with unknown outcomes.
* At minimum, run tests covering the affected area, `pnpm run compile-tests`, and `pnpm run lint`. Use `pnpm test` for release-equivalent verification.
* For Webview UI changes, verify protocol validation, message routing, and state restoration. When possible, also verify rendering and interaction in an actual Extension Host.
* If both `pnpm test` and `pnpm run test:unsafe` cannot start because of Electron/Chromium sandbox restrictions, run compile and lint separately and report the tests that were not run, the key points from the full error output, and the expected impact.
* Even when classifying a test failure as a pre-existing defect, do not ignore it without evidence. Verify and report whether it reproduces before the change.

## 7. Agent Workflow

* Before editing, check `git status` and the relevant diff. Do not revert changes that you did not make.
* For non-trivial decisions involving specifications or the synchronization lifecycle, review existing documents under `docs/planning/` and `docs/implementation-decisions/`, and update documentation with the same responsibility when necessary.
* Limit changes to the requested scope. Before making broad synchronization design changes, incompatible persisted-format changes, dependency upgrades, secret-related operations, or destructive queue operations, ask the user for confirmation.
* Work reports must include changed files, preserved invariants, validations performed, and validations that could not be performed together with the reasons.

## 8. Update Rules

* Update `AGENTS.md` in the same PR when changing any of the following:

  * `package.json` scripts, the VS Code/TypeScript baseline, or major development workflows
  * Major directories, entry points, or module boundaries
  * Persisted queue schema, synchronization lifecycle, or recovery policy
  * Placement and operational rules for major planning/specification documents

<!-- headroom:rtk-instructions -->
