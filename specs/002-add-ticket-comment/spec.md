# Feature Specification: Add Ticket Comment

**Feature Branch**: `002-add-ticket-comment`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "Allow adding a comment to the selected ticket."

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Add Comment to Selected Ticket (Priority: P1)

As a developer, I want to add a new comment to the selected ticket so I can
update progress without leaving VS Code.

**Why this priority**: Commenting is a core collaboration workflow for tickets.

**Independent Test**: A user selects a ticket, enters a comment, submits it, and
sees the new comment appear in the ticket history.

**Acceptance Scenarios**:

1. **Given** a ticket is selected, **When** the user submits a comment,
   **Then** the comment is added to that ticket.
2. **Given** a comment is submitted successfully, **When** the comment list
   refreshes, **Then** the new comment appears in the list.
3. **Given** the comment input is empty, **When** the user submits,
   **Then** the system blocks submission and shows a message.

---

### Edge Cases

- What happens when the ticket is no longer available?
- How does the system handle a comment submission failure?
- What happens when the user lacks permission to add comments?

## Clarifications

### Session 2025-12-26

- Q: How should users enter comments? → A: Use a command that opens an input prompt.
- Q: What happens after submitting a comment? → A: Keep the input open and clear it.
- Q: How should empty submissions be handled? → A: Reject empty or whitespace-only comments.
- Q: What happens when submission fails? → A: Keep input content and allow retry.
- Q: Is there a comment length limit? → A: Yes, limit to 20000 characters and show guidance before submit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a way to add a comment to the currently
  selected ticket.
- **FR-001a**: System MUST open an input prompt for comment submission when the
  user runs the add-comment command.
- **FR-001b**: System MUST keep the input prompt open after submission and clear
  the previous text.
- **FR-002**: System MUST prevent empty comment submissions.
- **FR-002a**: System MUST treat whitespace-only input as empty.
- **FR-003**: System MUST refresh the comment list after a successful submit.
- **FR-004**: System MUST show a clear error message when comment submission
  fails.
- **FR-004a**: System MUST preserve the comment input after failure and allow
  retry.
- **FR-005**: System MUST restrict comment submission to tickets the user can
  access.
- **FR-005a**: System MUST enforce a 20000-character limit and display guidance
  before submission.

### Key Entities *(include if feature involves data)*

- **Ticket**: The selected ticket receiving the comment.
- **Comment**: A new text entry added to the ticket history.

### Assumptions

- Users already have valid access to their Redmine instance.
- Users have permission to add comments to the selected ticket.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of comment submissions complete within 5 seconds.
- **SC-002**: 95% of successful submissions appear in the comment list within 5 seconds.
- **SC-003**: User-reported failures to add comments are under 2% per release.
