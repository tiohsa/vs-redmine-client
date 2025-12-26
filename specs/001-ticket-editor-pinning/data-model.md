# Data Model: Ticket Editor Pinning

## Entities

### Ticket
- **Fields**: id, subject, description, comments
- **Validation**: id is required and unique
- **Relationships**: One Ticket has zero or more Ticket Editors; one Ticket has zero or more Comment Drafts

### Ticket Editor
- **Fields**: editorId, ticketId, kind (primary | extra), lastActiveAt, isOpen
- **Validation**: editorId is required and unique; exactly one primary editor per ticket when open
- **Relationships**: Belongs to one Ticket; may hold zero or more Comment Drafts

### Comment Draft
- **Fields**: draftId, ticketId, editorId, content, updatedAt, status (editing | saved | discarded)
- **Validation**: ticketId required; content may be empty when status is editing
- **Relationships**: Belongs to one Ticket and one Ticket Editor

## State Transitions

### Ticket Editor
- **open -> active**: when focused or selected
- **active -> inactive**: when another editor gains focus
- **inactive -> closed**: when the user closes the editor

### Comment Draft
- **empty -> editing**: when user starts typing
- **editing -> saved**: when comment is posted
- **editing -> discarded**: when user discards the draft
- **editing -> editing**: when switching tickets, draft is preserved on the ticket

## Constraints

- Ticket selection must resolve to exactly one active editor for the ticket.
- The last active editor is the default focus target when multiple exist for the ticket.
- If the primary editor is closed, a new primary editor is created on next selection.
