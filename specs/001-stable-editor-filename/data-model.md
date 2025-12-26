# Data Model: Stable Editor Filenames with Comment Numbers

## Entity: Ticket Save Filename

- **Purpose**: Stable filename for ticket editor saves.
- **Fields**:
  - `projectId`: Identifier for the project.
  - `ticketId`: Identifier for the ticket.
  - `suffix`: Optional static suffix to distinguish editor type.

## Entity: Comment Save Filename

- **Purpose**: Stable filename for comment editor saves.
- **Fields**:
  - `projectId`: Identifier for the project.
  - `ticketId`: Identifier for the ticket.
  - `commentId`: Identifier for the comment.
  - `suffix`: Optional static suffix to distinguish editor type.

## Entity: Comment List Item

- **Purpose**: Display entry for a comment.
- **Fields**:
  - `commentId`: Comment number displayed in the list.
  - `summary`: Short comment preview.

## Validation Rules

- Filenames must be deterministic for the same identifiers.
- Filenames must be unique across different ticket/comment IDs.
- Comment list items must include a comment number when available.
