# Research: Editor Save Sync to Redmine

## Decision 1: Conflict handling on save

- **Decision**: Block the save, inform the user, and require a refresh before retrying.
- **Rationale**: Prevents accidental overwrites and preserves data integrity.
- **Alternatives considered**: Allow overwrite with warning; auto-merge; save locally only and defer.

## Decision 2: Update payload scope

- **Decision**: Send only fields that changed since the last successful save.
- **Rationale**: Minimizes the risk of overwriting unrelated updates and reduces payload size.
- **Alternatives considered**: Send all fields; send only a predefined subset of fields.

## Decision 3: Redmine unreachable behavior

- **Decision**: Show a failure message and keep local edits intact.
- **Rationale**: Ensures users do not lose work and are aware the update failed.
- **Alternatives considered**: Discard changes; retry silently in the background; mark as success and defer.

## Decision 4: Deleted or inaccessible ticket handling

- **Decision**: Block the save and show the reason to the user.
- **Rationale**: Avoids creating false expectations of a successful update and prevents invalid writes.
- **Alternatives considered**: Create a new ticket; save locally only; fail silently.

## Decision 5: Success feedback style

- **Decision**: Show a brief success notification.
- **Rationale**: Confirms update without interrupting the user flow.
- **Alternatives considered**: Modal confirmation; only status bar update.
