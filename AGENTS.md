# AGENTS.md

## Project

`redmine-client` is a VS Code extension for managing Redmine 6.1 issues, comments, Markdown editing, Dashboard interactions, and offline synchronization.

* TypeScript 5.9 in `strict` mode
* VS Code `^1.107.0`
* webpack 5
* `@vscode/test-cli` + Mocha
* ESLint 9
* Extension entry point: `src/extension.ts`

Write responses, documentation, and review comments in Japanese. Preserve commands, API names, identifiers, and source notation as-is.

Use the repository as the primary source of truth.

Consult these only when relevant:

* `docs/planning/` for plans
* `docs/implementation-decisions/` for design and lifecycle decisions
* `docs/review/` for review results
* nearby tests for established executable behavior
* local `DESIGN.md` for Dashboard UI decisions, if it exists

If a local `DESIGN.md` exists, treat it as the authority for Dashboard visual/layout decisions. If it does not exist, do not invent design-system values.

## Architecture Boundaries

Preserve the existing ownership model.

* `src/extension.ts`: composition root only.
* `src/app/`: application orchestration, command/view registration, notifications, save classification, synchronization coordination.
* `src/app/ticketSync/`: synchronization state machine, operation handlers, repositories, reconciliation, remote-write finalization.
* `src/dashboard/`: Dashboard protocol, validation, routing, controllers, state, services, view models, HTML/CSS/scripts.
* `src/commands/`: thin command adapters; do not duplicate synchronization logic here.
* `src/views/`: Markdown editor, drafts, persisted unsynced queue, conflicts, presentation adapters.
* `src/views/ticketSync/`: editor/queue integration boundary with the application layer.
* `src/redmine/`: Redmine HTTP API, authentication, domain API operations and types.
* `src/config/`: VS Code configuration, connection scope, project selection, SecretStorage-backed API keys.
* `src/utils/`: generic utilities only; do not move domain-specific logic here.
* `src/test/`: Extension Host tests; shared test helpers belong under `src/test/helpers/`.

Generated artifacts:

* `dist/`: webpack output
* `out/`: TypeScript/test compilation output

Never edit generated artifacts directly.

## Non-Negotiable Invariants

Preserve these unless the requested task explicitly changes the corresponding behavior.

### Dashboard protocol boundary

Treat Webview messages as untrusted input.

Validate Dashboard payloads at the existing protocol/validation boundary before controller or service use, including:

* `dashboardProtocol.ts`
* `dashboardMessageValidation.ts`

Do not bypass validation by routing raw Webview messages directly into application logic.

### Localization and secrets

Use `vscode.l10n.t` for user-facing strings and keep the corresponding localization resources in sync.

API keys must remain in VS Code SecretStorage, keyed by the existing normalized connection scope hash. Never inherit credentials from another connection scope, including nested asynchronous contexts. Never write real credentials to settings, logs, fixtures, tests, or documentation.

Legacy API key migration is limited to the valid configured connection at initialization. Persist its migration owner in SecretStorage before copying, preserve existing scoped keys, and never copy the legacy key to another scope after a partial failure.

Requests require HTTPS except for HTTP loopback hosts (`localhost`, `127.0.0.1`, `::1`). Reject insecure remote URLs before sending credentials.

Keep `ignoreSSLErrors` limited to development/verification scenarios.

### Persistent offline state

`src/views/offlineSyncStore.ts` contains state that survives VS Code restarts.

Changes to its schema, keying, scope, revision, generation, or phase must preserve restart restoration and explicitly account for legacy data.

For all live queue mutations within one `connectionScope`:

1. enter the store's scope transaction boundary;
2. obtain the current snapshot inside that boundary;
3. persist the candidate state before exposing it in memory;
4. keep production mutation APIs asynchronous.

Do not reintroduce:

* direct live-memory writers;
* stale whole-queue replacement;
* cross-scope queue mutation.

Never mix drafts, queues, or persistent effects across Redmine connection scopes.

### Synchronization lifecycle

All synchronization writes must pass through the existing lifecycle in:

* `src/app/syncEngine.ts`
* `src/app/ticketSync/`

Preserve the repository's remote-write, read-back/reconciliation, and local-finalization ordering.

Do not add a new write path that bypasses this lifecycle.

Primary Operation phase and Primary Effect state must transition atomically through:

`SyncOperationRepository.transitionPrimaryRemoteWrite`

Keep them in one persistence operation so the operation ledger and effect ledger cannot diverge.

### Revision and remote-attempt fences

Intent `revision` and Remote Attempt `attemptGeneration` are different fences. Preserve both.

Legacy Memento v3 entries without `attemptGeneration` restore as generation `1`.

Persistent callbacks, retries, reconciliation results, or finalization from an obsolete generation must not update the active operation and must be rejected without a persistence write.

Never apply persistent effects while ignoring operation scope, revision, or attempt generation.

### Effects and compensation

Planned Effects are monotonic and idempotent.

Effects already in a non-planned state such as:

* `committed`
* `started`
* `failed`
* `commit_unknown`

must not be moved back to `planned` during replanning unless an explicit compensation flow justifies it.

Full current-generation compensation may close the current Attempt only when the shared Operation-level rollback-obligation decision proves every Effect safe.

That decision must account for:

* Effect kind and state
* ownership
* compensation coverage
* revision
* `attemptGeneration`

Do not classify all `committed` effects as uniformly safe or unsafe.

Repository-specific rule:

* a committed attachment is covered only when the compensated Primary Ticket CREATE snapshot contains its exact token;
* an independently committed Child remains a blocker.

When a compensated attempt is safely closed:

* remove its Effects and remote identities from the active set;
* queue the operation for the next `attemptGeneration`;
* reject late callbacks/retries from the previous generation.

Do not weaken this decision merely to make recovery or tests simpler.

### Unknown remote outcomes and retries

Treat `commit_unknown` as an uncertain remote result, not as an ordinary retryable failure.

Do not automatically retry:

* `commit_unknown`;
* known non-retryable remote failures.

An explicit retry of the same revision must reuse the frozen API-ready `RequestSnapshot`.

Ticket Update Recovery must use one of the supported update-recovery paths such as:

* `reconcile_remote`
* `assume_update_committed`
* an explicitly safe retry

`link_remote_ticket` is not a valid Ticket Update Recovery Action.

### Attachment identity

For File and Clipboard attachments, freeze remote-write identity before the write begins, including:

* `contentHash`
* `contentSize`
* `spoolFilePath`

Preserve this identity across retries and VS Code restarts.

Do not regenerate attachment identity in a way that breaks idempotency.

### Destructive operations

Discard, force-sync, migration, compensation, or remote-write retry behavior may destroy or detach local/remote state.

Do not silently broaden destructive behavior.

When the requested change introduces a materially new destructive operation or incompatible persistent-state transition, make the impact and recovery behavior explicit in the implementation/report.

## Implementation Discipline

Keep TypeScript strict. Do not solve typing problems with unnecessary `any`, broad assertions, disabled checks, or weakened interfaces.

Follow existing ESLint rules and module boundaries.

Reuse existing synchronization and persistence primitives rather than creating parallel abstractions.

Do not introduce unrelated:

* large refactors
* dependencies
* persisted-format changes
* synchronization redesigns
* formatting churn

When changing persisted formats, synchronization state transitions, recovery policy, or scope semantics, inspect the relevant implementation-decision documents and existing restoration/recovery tests before editing.

For Dashboard UI changes, use `DESIGN.md` when present. If visual intent remains unspecified, preserve the existing design rather than inventing a new one.

## Validation

Use the smallest validation set that can reliably detect regressions in the changed area, then expand according to risk.

For synchronization or persistence changes, validate the relevant failure modes, especially:

* conflicts
* partial remote success
* restart restoration
* revision mismatch
* obsolete `attemptGeneration`
* `commit_unknown`
* retry/reconciliation behavior
* connection-scope isolation

For Dashboard changes, validate protocol input, routing, state restoration, and the changed interaction/rendering behavior.

Typical repository validation includes affected tests plus compile/type validation and lint. Use the release-equivalent Extension Host path when the change risk warrants it.

If Electron/Chromium sandbox restrictions prevent Extension Host execution, run the validations that can execute and report the blocked test path and its impact. Do not use a sandbox-specific alternative merely to hide a functional failure.

When a validation fails, first classify it as:

1. caused by the current change;
2. pre-existing;
3. environment/infrastructure.

Do not ignore a claimed pre-existing failure without evidence that it reproduces independently of the change.

Do not weaken assertions, skip lifecycle checks, or retry the same ineffective fix repeatedly.

## Working With Existing Changes

Before editing, inspect the relevant working-tree state and diff so existing user changes are not accidentally reverted.

Do not revert or rewrite unrelated modifications.

Use repository history or documentation only as much as needed to understand the affected behavior; do not perform a full repository audit for a narrow task.

## Completion

Continue through implementation, directly caused regression fixes, and relevant validation without stopping after the first code change for routine approval.

A task is complete when:

* the requested behavior is implemented;
* affected architecture boundaries and synchronization invariants remain intact;
* persistent-state compatibility is preserved or intentionally handled;
* directly caused regressions are fixed;
* relevant validation passes;
* generated artifacts are regenerated when required;
* secrets, localization, and connection-scope isolation remain correct.

Report:

* changed files;
* important invariants preserved or intentionally changed;
* validation performed;
* validation that could not be performed and why.

Report unrelated worthwhile improvements separately instead of expanding the requested scope.

Update `AGENTS.md` when the repository itself changes any rule that this file is intended to encode, especially:

* toolchain or major development workflow;
* major module boundaries or entry points;
* persisted queue schema;
* synchronization lifecycle or recovery policy;
* planning/specification document ownership.

<!-- headroom:rtk-instructions -->
