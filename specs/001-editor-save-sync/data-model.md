# Data Model: Editor Save Sync to Redmine

## Entity: Ticket Draft

- **Purpose**: Represents the user's current edits for a Redmine ticket in the editor.
- **Fields**:
  - `ticketId`: Unique identifier of the Redmine ticket.
  - `changedFields`: Map of field name to new value for fields changed since last save.
  - `lastSyncedAt`: Timestamp of the last successful sync.
  - `lastKnownRemoteUpdatedAt`: Timestamp of the ticket version last seen in Redmine.
  - `status`: Draft state, one of `clean`, `dirty`, `conflict`.

## Entity: Redmine Ticket

- **Purpose**: Authoritative ticket record in Redmine.
- **Fields**:
  - `ticketId`: Unique identifier of the ticket.
  - `fields`: Set of user-editable fields (e.g., subject, description, status, custom fields).
  - `updatedAt`: Last updated timestamp from Redmine.

## Entity: Sync Result

- **Purpose**: Outcome of a save attempt.
- **Fields**:
  - `status`: One of `success`, `failed`, `conflict`.
  - `message`: User-facing summary for success or failure.
  - `errorCode`: Optional categorization for failure (e.g., `unreachable`, `forbidden`, `not_found`).

## Relationships

- A Ticket Draft targets exactly one Redmine Ticket.
- Each save attempt produces one Sync Result associated with the Ticket Draft.

## Validation Rules

- `changedFields` must be empty when `status` is `clean`.
- Save is blocked when `status` is `conflict`.
- `lastKnownRemoteUpdatedAt` must be updated after a successful refresh.
