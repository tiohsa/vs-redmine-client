# redmine

## Purpose

Implements transport and resource-level adapters for the Redmine API. Translates Redmine responses into the values used by the extension.

## File Index

- `client.ts`: Resolves connection context and transport options, builds API URLs, and exposes JSON and text requests.
- `attachments.ts`: Uploads buffers, files, and clipboard images and maps upload responses to tokens and attachment metadata.
- `comments.ts`: Maps issue journals into comments and builds payloads for adding or updating notes.
- `httpError.ts`: Represents HTTP status failures and normalizes errors used by create operations.
- `issues.ts`: Builds issue list queries and write payloads, maps issue details, and retrieves issue metadata.
- `projects.ts`: Lists projects and paginated memberships and retrieves available project trackers.
- `types.ts`: Defines Redmine response shapes and shared project, ticket, and comment models.
- `users.ts`: Fetches the current user ID and searches users by name.

## Local Rules & Conventions

- Send resource requests through `requestJson` or `requestText`. Use `buildUrl` semantics that preserve a base URL's Redmine subdirectory.
- Keep wire names and payload keys at the resource boundary. Put response mapping beside the endpoint that consumes it.
- Preserve status information in errors so callers can distinguish rejected operations from uncertain outcomes.
- Keep pagination and query construction in the resource modules. Leave editor updates, retries, reconciliation, and queue decisions to callers.
