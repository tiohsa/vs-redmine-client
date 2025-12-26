# Data Model: Project List Sidebar

## Project

- Fields: id, name, identifier, parentId, hasChildren
- Relationships: Project has many Tickets.

## Ticket

- Fields: id, subject, description, statusId, statusName, assigneeId,
  assigneeName, projectId, createdAt, updatedAt
- Relationships: Ticket belongs to Project.

## Project Selection

- Fields: projectId, projectName
- Rules: Selected project is highlighted and persisted across sessions.
