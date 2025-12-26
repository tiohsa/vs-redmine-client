# Research: Stable Editor Filenames with Comment Numbers

## Decision 1: Filename schema

- **Decision**: Use a deterministic filename derived from project, ticket, and optional comment identifiers.
- **Rationale**: Prevents filename churn on content edits and keeps files uniquely identifiable.
- **Alternatives considered**: Use comment body slug; use timestamps; keep default untitled names.

## Decision 2: Comment list numbering

- **Decision**: Display comment number alongside the existing summary text for each list item.
- **Rationale**: Improves comment identification with minimal UI change.
- **Alternatives considered**: Show comment number only in tooltip; add a separate column.
