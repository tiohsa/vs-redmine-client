# Feature Specification: Add Comment Add Button

**Feature Branch**: `001-add-comment-button`  
**Created**: 2025-12-27  
**Status**: Draft  
**Input**: User description: "コメントの追加ボタンも追加"

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Add comment from comments header (Priority: P1)

As a user viewing a ticket's comments list, I can start adding a new comment directly from the comments header using a clear add button.

**Why this priority**: This adds the requested entry point and reduces friction when adding comments.

**Independent Test**: Can be fully tested by opening the comments list for a ticket and using the header add button to initiate the existing comment add flow.

**Acceptance Scenarios**:

1. **Given** the user is viewing the comments list for a ticket, **When** they click the add button in the comments header, **Then** the existing add comment flow opens for that ticket.
2. **Given** the user is viewing the comments list for a ticket, **When** they hover the add button, **Then** an accessible label is visible (e.g., tooltip or screen-reader text).

---

### User Story 2 - Permission-aware add comment button (Priority: P2)

As a user without permission to add comments, I see the add button disabled with a clear indication that commenting is unavailable.

**Why this priority**: Prevents failed actions and clarifies permissions for users who cannot comment.

**Independent Test**: Can be fully tested by simulating a user without comment permission and verifying the button state and label.

**Acceptance Scenarios**:

1. **Given** a user who cannot add comments, **When** they view the comments header, **Then** the add button is visible but disabled with an explanatory label.

---

### User Story 3 - No disruption to existing comment actions (Priority: P3)

As a user browsing comments, the new add button does not interfere with existing comment actions or navigation.

**Why this priority**: Preserves current usability while adding the new entry point.

**Independent Test**: Can be fully tested by interacting with existing comment actions before and after the button is present.

**Acceptance Scenarios**:

1. **Given** existing comment actions are available, **When** the add button is present, **Then** all existing actions remain usable and unchanged.

---

### Edge Cases

- What happens when the user clicks the add button while a comment draft is already open?
- How does the system handle a permission change while the comments list is open?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a new add comment button in the comments list header.
- **FR-002**: Clicking the add button MUST initiate the same comment creation flow as the existing add comment action.
- **FR-003**: The add button MUST be accessible with a visible label or screen-reader text that describes its purpose.
- **FR-004**: Users without permission to add comments MUST see the add button visible but disabled with an explanatory label.
- **FR-005**: The add button MUST NOT reduce or block access to existing comment actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can start adding a comment from the comments header in 2 or fewer interactions.
- **SC-002**: 95% of users who are allowed to add comments can reach the comment editor on the first attempt from the comments header.
- **SC-003**: Users report no decrease in ability to use existing comment actions after the button is added (e.g., 0 regressions in usability feedback).

## Dependencies

- Existing add comment flow is available from the comments list view.

## Assumptions

- The comments list header already exists and is visible to users.
- Permission rules for adding comments already exist and should be respected by this button.
