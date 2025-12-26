# Data Model: Redmine Ticket Workflow

## Project

- Fields: id, name, identifier, parentId, hasChildren
- Relationships: Project has many Tickets; Project may have child Projects.

## Ticket

- Fields: id, subject, description, statusId, statusName, assigneeId,
  assigneeName, projectId, createdAt, updatedAt
- Relationships: Ticket belongs to Project; Ticket has many Comments and
  Attachments.

## Comment

- Fields: id, ticketId, authorId, authorName, body, createdAt, updatedAt,
  editableByCurrentUser
- Relationships: Comment belongs to Ticket.
- Rules: Only comments with editableByCurrentUser = true can be edited.

## Attachment

- Fields: id, ticketId, filename, contentType, sizeBytes, uploadToken,
  downloadUrl
- Relationships: Attachment belongs to Ticket.
- Rules: Images may be attached from file selection or clipboard paste.

## Filter

- Fields: statusIds, assigneeIds, includeChildProjects, limit, offset
- Rules: status and assignee options are shown even when no tickets match.

## State Notes

- Ticket list loads default limit = 50 and paginates beyond that.
- Ticket preview is read-only.
