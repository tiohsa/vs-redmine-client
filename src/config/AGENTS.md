# config

## Purpose

Provides typed access to VS Code settings, project selection, and connection identity. Owns credential lookup and migration for Redmine connections.

## File Index

- `apiKeyStore.ts`: Initializes credential storage, migrates the legacy key, and exposes direct scoped reads and a cache for synchronous UI status.
- `connectionScope.ts`: Derives stable scope identities and hashes, preferring the active request context when present.
- `projectSelection.ts`: Validates numeric project IDs and persists explicit, cleared, or all-project selections.
- `settings.ts`: Exposes typed configuration accessors, editor default fields, and the workspace offline-sync mode setter.

## Local Rules & Conventions

- Keep setting accessors in `settings.ts` aligned with the defaults and types in `../../package.json`.
- Preserve the distinction between cleared selection and the explicit `all` sentinel. Cleared selection allows the default project to apply.
- Persist project selection at the global configuration target and offline-sync mode at the workspace target.
- Migrate the legacy key to the configured URL captured when initialization starts. Record its owner before copying it and persist the destination before deleting the old key.
- Keep malformed base URLs deterministic for local scope identity. Credential writes still go through URL validation.
- Use direct credential reads for HTTP requests. Reserve the revision-guarded cache for synchronous UI callers.
