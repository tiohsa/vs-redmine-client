# helpers

## Purpose
Provides reusable fixtures, stubs, and in-memory adapters for extension-host tests. Helpers keep setup consistent while allowing tests to control VS Code and persistence behavior.

## File Index
- `configuration.ts`: Configures test workspace settings.
- `editorStubs.ts`: Supplies editor and text-document test doubles.
- `markdownImageFixtures.ts`: Defines reusable Markdown image test data.
- `markdownImageTestUtils.ts`: Supports Markdown image test setup and assertions.
- `packageJson.ts`: Reads extension contribution and localization metadata for tests.
- `secretStorage.ts`: Provides an in-memory SecretStorage implementation.
- `syncLifecycleFixtures.ts`: Builds synchronization lifecycle test records and fixtures.
- `ticketEditorMetadataStubs.ts`: Supplies ticket-editor metadata test doubles.
- `ticketMetadataFixtures.ts`: Defines ticket metadata fixture values.
- `treeFixtures.ts`: Builds tree-view test fixtures.
- `uploadSpoolSetup.ts`: Sets up upload spool storage for tests.
- `vscodeMemento.ts`: Provides an in-memory VS Code Memento implementation.

## Local Rules & Conventions
- Keep scenario-specific expectations in the owning suite. Put shared setup and test doubles here.
- When extending a VS Code test double, preserve its asynchronous and persistence behavior where the test observes it.
- Keep fixture data stable and explicit so failures identify the behavior under test.
