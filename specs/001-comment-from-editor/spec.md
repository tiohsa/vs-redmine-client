# Feature Specification: Comment from Editor

**Feature Branch**: `001-comment-from-editor`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "Use editor content when adding or updating ticket comments."

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Add Comment from Editor Content (Priority: P1)

As a developer, I want to post the active editor content as a comment to the
selected ticket so I can add notes without copying and pasting.

**Why this priority**: This is the primary workflow for adding comments from
within VS Code.

**Independent Test**: A user selects a ticket, ensures an editor is active,
submits, and sees the editor text appear as a new comment.

**Acceptance Scenarios**:

1. **Given** a ticket is selected and an editor is active, **When** the user
   runs add-comment, **Then** the editor content is posted as a new comment.
2. **Given** the editor content is empty, **When** the user runs add-comment,
   **Then** submission is blocked with a message.
3. **Given** a comment is successfully posted, **When** the comment list
   refreshes, **Then** the new comment appears.

---

### User Story 2 - Update Comment from Editor Content (Priority: P2)

As a developer, I want to replace my existing comment with the active editor
content so I can revise notes using the editor.

**Why this priority**: Editing from the editor avoids context switching and
keeps changes consistent with local documentation.

**Independent Test**: A user selects one of their own comments, uses editor
content to update it, and sees the change reflected in the ticket history.

**Acceptance Scenarios**:

1. **Given** a comment owned by the user is selected and an editor is active,
   **When** the user runs edit-comment, **Then** the comment body is replaced
   with the editor content.
2. **Given** the editor content is empty, **When** the user runs edit-comment,
   **Then** submission is blocked with a message.
3. **Given** the comment update succeeds, **When** the comment list refreshes,
   **Then** the updated content appears.

---

### Edge Cases

- What happens when no editor is active?
- What happens when the selected ticket or comment is no longer available?
- How does the system handle submission failures?
- What happens when the user lacks permission to edit a comment?

## Clarifications

### Session 2025-12-26

- Q: How should users trigger add/edit from editor content? → A: Use command execution for both add and edit.
- Q: How should empty editor content be handled? → A: Reject whitespace-only content.
- Q: Should editor content enforce the Redmine length limit? → A: Yes, enforce 20000 characters with guidance.
- Q: What happens on submission failure? → A: Preserve editor content for retry.
- Q: Should legacy comment commands be replaced? → A: Replace legacy add/edit commands with editor-based commands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST use active editor content when adding a comment to a
  selected ticket.
- **FR-002**: System MUST use active editor content when updating a selected
  user-owned comment.
- **FR-002a**: System MUST invoke add/edit via explicit commands.
- **FR-003**: System MUST prevent empty or whitespace-only editor content from
  being submitted.
- **FR-003a**: System MUST treat whitespace-only editor content as empty.
- **FR-003b**: System MUST enforce a 20000-character limit and display guidance
  before submission.
- **FR-004**: System MUST refresh the comment list after successful add or edit.
- **FR-005**: System MUST show clear feedback when add or edit operations fail.
- **FR-005a**: System MUST preserve editor content on failure for retry.
- **FR-006**: System MUST require an active editor for add or edit operations.
- **FR-006a**: System MUST replace legacy add/edit comment commands with editor-based commands.

### Key Entities *(include if feature involves data)*

- **Ticket**: The selected ticket receiving the comment.
- **Comment**: The comment being added or updated.
- **Editor Content**: The current text content used for submission.

### Assumptions

- Users already have valid access to their Redmine instance.
- Users have permission to add comments and edit their own comments.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of add-comment submissions from editor complete within
  5 seconds.
- **SC-002**: 95% of edit-comment submissions from editor complete within
  5 seconds.
- **SC-003**: User-reported failures to add or update comments are under
  2% per release.
