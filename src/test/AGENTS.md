# test

## Purpose
Contains the extension-host unit and integration tests, plus shared harnesses for focused test suites. These tests exercise user-visible commands, views, persistence, and synchronization behavior against controlled dependencies.

## File Index
- `sync*.test.ts`, `durableSyncEffect.test.ts`, `secondaryEffectRestart.test.ts`: Check synchronization entry points, lifecycle, recovery, and effect durability.
- `offlineSync*.test.ts`, `legacyQueueMigration.test.ts`, `manualQueueState.test.ts`: Check queue persistence, migration, and manual or partial synchronization.
- `dashboard*.test.ts`, `composer*.test.ts`, `detailPanelResize.test.ts`: Check Dashboard messages, state, search, and Webview interactions.
- `ticket*.test.ts`, `newTicket*.test.ts`, `comment*.test.ts`, `editor*.test.ts`: Check editor, draft, metadata, and save behavior for tickets and comments.
- `markdownImage*.test.ts`, `attachments.test.ts`, `uploadSpoolStore.test.ts`: Check Markdown image handling, attachment transport, and durable spooling.
- `apiKeyStore.test.ts`, `connection*.test.ts`, `redmine*.test.ts`, `project*.test.ts`: Check credentials, connection identity, API adapters, and project behavior.
- `*.test.ts`: Remaining command, tree, and utility suites are named for the behavior they exercise.
- `liveRedmineSyncRecovery.test.ts`: Exercises image-comment recovery under the dedicated live recovery config.
- `referenceVerification.ts`: Executes mapped commands and checks results and resource budgets for the verification driver.

## Local Rules & Conventions
- Keep external Redmine scenarios in `live/`, with the separate `liveRedmineSyncRecovery.test.ts` suite handled by `../../.vscode-test-live-recovery.mjs`.
- Reuse fixtures and test doubles from `helpers/`. The standard Mocha configuration preloads `helpers/uploadSpoolSetup.ts` for test spool isolation.
- Place ordinary behavior checks in Mocha suites. The verification driver invokes the exported runner in `referenceVerification.ts` separately.
