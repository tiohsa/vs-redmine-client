# Data Model: Comment from Editor

## Ticket

- Fields: id, subject, projectId
- Relationships: Ticket has many Comments.

## Comment

- Fields: id, ticketId, authorId, authorName, body, createdAt
- Rules: Body must be non-empty and <= 20000 characters.

## Editor Content

- Fields: text
- Rules: Requires active editor and non-empty content.
