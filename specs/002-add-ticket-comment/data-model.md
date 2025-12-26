# Data Model: Add Ticket Comment

## Ticket

- Fields: id, subject, projectId
- Relationships: Ticket has many Comments.

## Comment

- Fields: id, ticketId, authorId, authorName, body, createdAt
- Rules: Body must be non-empty and <= 20000 characters.
