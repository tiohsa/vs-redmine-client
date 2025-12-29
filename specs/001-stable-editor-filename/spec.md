# Feature Specification: Stable Editor Filenames with Comment Numbers

**Feature Branch**: `001-stable-editor-filename`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "コメント一覧はコメントのNoを追加して表示する。エディタ保存時もプロジェクト、チケットNoとコメントのNoなどを組み合わせて一意になるファイル名にして保存する。チケットのエディタも同じ。現状はコメントがファイル名に反映されるためコメント記述のたびにファイル名が変更されるのを防止する"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Stable filenames on save (Priority: P1)

As a user, I want ticket and comment editor files to save with stable, unique filenames so the name does not change every time I edit content.

**Why this priority**: Unstable filenames disrupt workflows and make saved files hard to track.

**Independent Test**: Save the same ticket/comment multiple times and confirm the filename remains identical and uniquely identifies the record.

**Acceptance Scenarios**:

1. **Given** a ticket editor is open, **When** the user saves multiple times, **Then** the filename remains unchanged and stays unique to the ticket.
2. **Given** a comment editor is open, **When** the user saves multiple times, **Then** the filename remains unchanged and stays unique to the comment.

---

### User Story 2 - Comment list shows comment numbers (Priority: P2)

As a user, I want each comment in the list to display its comment number so I can identify it quickly.

**Why this priority**: Numbered comments improve clarity when editing or referencing specific comments.

**Independent Test**: Load the comment list and verify each item includes its comment number.

**Acceptance Scenarios**:

1. **Given** a ticket has multiple comments, **When** the comment list is displayed, **Then** each comment shows its comment number.

### Edge Cases

- What happens when a comment number is missing or unknown?
- How does the system handle two open editors for different comments in the same ticket?
- What happens when the user saves without choosing a location (cancel save)?
- What happens when a newly created comment receives its identifier after the first save?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST display each comment’s comment number in the comment list view.
- **FR-002**: System MUST generate a stable, unique filename for ticket editor saves based on project and ticket identifiers.
- **FR-003**: System MUST generate a stable, unique filename for comment editor saves based on project, ticket, and comment identifiers.
- **FR-004**: System MUST prevent filename changes caused by comment body edits.
- **FR-005**: System MUST keep filenames consistent across multiple saves of the same ticket or comment.
- **FR-006**: System MUST keep filenames unique across different tickets and comments.
- **FR-007**: System MUST allow a one-time filename update after a new comment is created to include the comment identifier, then keep it stable.
- **FR-008**: System MUST include a comment type label ("comment") in comment editor filenames.

### Key Entities *(include if feature involves data)*

- **Comment List Item**: A displayed entry for a comment, including its number and summary.
- **Ticket Save Filename**: The saved filename that uniquely identifies a ticket editor.
- **Comment Save Filename**: The saved filename that uniquely identifies a comment editor.
- **Comment Type Label**: A fixed label used in comment editor filenames to distinguish comment files.

### Assumptions

- Project and ticket identifiers are available when saving an editor.
- Comment identifiers are available when saving a comment editor.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 100% of saved ticket editor files keep the same filename across repeated saves for the same ticket.
- **SC-002**: 100% of saved comment editor files keep the same filename across repeated saves for the same comment.
- **SC-003**: 100% of visible comment list items display a comment number when available.
- **SC-004**: Reports of “filename changes on every save” drop to zero for this feature.
