# Feature Specification: Redmine Ticket Workflow

**Feature Branch**: `001-redmine-ticket-workflow`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "Integrate Redmine 6.1 with VS Code to manage tickets end-to-end, including ticket listing, creation from editor content, image attachment, Mermaid conversion for redmica_ui_extension, and comment editing."

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Browse and Preview Tickets (Priority: P1)

As a developer, I want to browse tickets by project in the VS Code sidebar with
filters, so I can review work without leaving my editor.

**Why this priority**: Ticket visibility is the base workflow for all other
actions.

**Independent Test**: A user can load a project, filter the list, select a
ticket, and see a read-only preview without performing any edits or posts.

**Acceptance Scenarios**:

1. **Given** a project is selected, **When** the sidebar loads, **Then** tickets
   for the project appear in a list.
2. **Given** the user enables child project inclusion, **When** the list loads,
   **Then** tickets from the parent and its children appear together.
3. **Given** status and assignee filters are set, **When** the list refreshes,
   **Then** only matching tickets are shown.
4. **Given** a ticket is selected from the list, **When** the preview opens,
   **Then** a read-only view of the ticket is shown in the editor area.

---

### User Story 2 - Create Tickets from Editor Content (Priority: P2)

As a developer, I want to post the active editor content as a new ticket with
attachments and correct Mermaid formatting so I can log work quickly.

**Why this priority**: Creating tickets directly from the editor avoids
context switching and keeps documentation in the workflow.

**Independent Test**: A user can create a ticket from editor text, attach a
local image, and verify the posted description renders Mermaid correctly.

**Acceptance Scenarios**:

1. **Given** an active editor with text, **When** the user submits a new ticket,
   **Then** the ticket is created using the editor content as the description.
2. **Given** the editor content includes a Mermaid code block, **When** the
   ticket is submitted, **Then** the posted description contains the converted
   `{{mermaid ... }}` block.
3. **Given** an image file is selected for attachment, **When** the ticket is
   submitted, **Then** the image is attached to the created ticket.

---

### User Story 3 - Edit Existing Comments (Priority: P3)

As a developer, I want to edit my own ticket comments in the editor and save
changes, so I can correct or refine discussions without leaving VS Code.

**Why this priority**: Comment editing completes the feedback loop and reduces
tool switching.

**Independent Test**: A user can select their own comment, edit it in the
editor, save it, and confirm the update is reflected in the ticket history.

**Acceptance Scenarios**:

1. **Given** a ticket with comments, **When** the comment list is opened,
   **Then** existing comments are displayed and the user's own comments are
   selectable for editing.
2. **Given** the user's own comment is selected, **When** it is edited and
   saved, **Then** the updated text appears in the ticket history.

---

### Edge Cases

- What happens when a project has no tickets or no child projects?
- How does the system handle missing or unreadable image files?
- What happens when a Mermaid code block is malformed or empty?
- How does the system respond when the user lacks permission to edit comments?
- What happens when the ticket list fails to refresh?
- How does the system handle an empty clipboard or non-image clipboard data?
- How does the system handle filters with no matching tickets?
- What happens when there are more than 50 tickets in the list?

## Clarifications

### Session 2025-12-26

- Q: Which comments can be edited? -> A: Only the user's own comments.
- Q: What authentication method is used for Redmine? -> A: API key.
- Q: How are images attached? -> A: File selection and clipboard paste.
- Q: How are filter options presented? -> A: Show full status/assignee options even if empty.
- Q: What is the default ticket list size? -> A: Latest 50 with pagination.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST list tickets by project in the sidebar.
- **FR-001a**: System MUST load the latest 50 tickets by default and support
  loading more on demand.
- **FR-002**: System MUST support including child project tickets when enabled.
- **FR-003**: System MUST provide dynamic filtering by status and assignee.
- **FR-003a**: System MUST present status and assignee filters with full option
  lists, even if no tickets match a given option.
- **FR-004**: System MUST display a read-only ticket preview when a ticket is
  selected.
- **FR-005**: Users MUST be able to create a ticket using the active editor
  content as the description.
- **FR-006**: System MUST allow attaching one or more local image files to a
  newly created ticket.
- **FR-006a**: System MUST support attaching images from the clipboard.
- **FR-007**: System MUST transform Mermaid code blocks from
  ```mermaid ...``` to `{{mermaid ... }}` on submission.
- **FR-008**: System MUST list existing comments for a selected ticket.
- **FR-009**: Users MUST be able to edit their own selected comment and save
  changes.
- **FR-010**: System MUST be compatible with Redmine 6.1.0 servers.
- **FR-011**: System MUST provide clear feedback when any ticket action fails
  (load, filter, preview, create, attach, or comment edit).
- **FR-012**: System MUST allow users to authenticate using an API key.

### Key Entities *(include if feature involves data)*

- **Project**: A Redmine project that can be selected in the sidebar; may have
  child projects.
- **Ticket**: A work item with title, description, status, assignee, and
  comments.
- **Comment**: A text update associated with a ticket that can be edited.
- **Attachment**: A file associated with a ticket, including images.
- **Filter**: Status and assignee criteria applied to the ticket list.

### Assumptions

- Users already have valid access to their Redmine instance and projects.
- Users have permission to create tickets and edit existing comments.
- Image files referenced for attachment are accessible on the local machine.
- Users can obtain and manage their Redmine API key.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of ticket list loads complete within 3 seconds for a typical
  project.
- **SC-002**: 90% of users can create a ticket from editor content in under
  2 minutes without leaving VS Code.
- **SC-003**: 100% of submitted Mermaid blocks are converted to the
  `{{mermaid ... }}` format in posted descriptions.
- **SC-004**: 95% of comment edits are reflected in ticket history within
  10 seconds.
- **SC-005**: User-reported failures for attachments and conversions are under
  2% of submissions per release.
