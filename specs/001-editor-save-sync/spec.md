# Feature Specification: Editor Save Sync to Redmine

**Feature Branch**: `001-editor-save-sync`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "編集エディタを保存したらRedmineに変更を送信して変更する"

## Clarifications

### Session 2025-12-26

- Q: 保存時の競合（Redmine側で更新されていた場合）の扱い → A: 更新をブロックし、再読み込みを促す
- Q: Redmineへの送信対象（どの項目を更新するか） → A: 変更された項目のみ送信する
- Q: Redmineが到達不能なときの扱い → A: 失敗を表示し、ローカル編集は保持する
- Q: Redmine側で削除/権限喪失が判明した場合の扱い → A: 保存をブロックし、理由を表示する
- Q: 成功時のフィードバック方法 → A: 軽い成功通知（短時間表示）

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

### User Story 1 - Save editor changes to Redmine (Priority: P1)

As a user editing a Redmine ticket in the editor, I want my changes to be sent to Redmine when I save so the ticket is updated without extra steps.

**Why this priority**: This is the core value of the feature: saving should update the ticket in Redmine.

**Independent Test**: Save a draft with modified fields and confirm the ticket in Redmine reflects the new values.

**Acceptance Scenarios**:

1. **Given** a ticket is open in the editor with unsaved changes, **When** the user saves, **Then** Redmine reflects the updated fields.
2. **Given** a ticket is open with no changes since the last save, **When** the user saves, **Then** no update is sent and the user sees no error.

---

### User Story 2 - Clear feedback on sync result (Priority: P2)

As a user, I want clear feedback on whether my save updated Redmine so I can trust the editor state.

**Why this priority**: Without feedback, users cannot distinguish successful updates from failures.

**Independent Test**: Trigger a successful save and a failed save and confirm the feedback differs and is user-visible.

**Acceptance Scenarios**:

1. **Given** the save completes successfully, **When** the user saves, **Then** the user sees confirmation that Redmine was updated.
2. **Given** the save fails due to a sync error, **When** the user saves, **Then** the user sees a failure message and their local edits remain.

### Edge Cases

- What happens when Redmine is unreachable at save time?
- How does the system handle a ticket that was deleted or made inaccessible? The save is blocked and the reason is shown to the user.
- What happens if the ticket was changed in Redmine after the editor loaded?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST detect editor save events for Redmine ticket edits.
- **FR-002**: System MUST send the saved changes to the corresponding Redmine ticket.
- **FR-002a**: System MUST send only fields that changed since the last successful save.
- **FR-003**: System MUST avoid sending updates when there are no changes since the last successful save.
- **FR-004**: System MUST present clear user feedback for success and failure of the save-to-Redmine action.
- **FR-004a**: System MUST inform the user when the ticket is deleted or access is lost and block the save.
- **FR-004b**: System MUST present a brief success notification after a successful save.
- **FR-005**: System MUST preserve local edits when a save-to-Redmine action fails.
- **FR-005a**: System MUST surface a failure message when Redmine is unreachable and keep local edits intact.
- **FR-006**: System MUST detect a remote change conflict and prevent overwriting without user awareness.
- **FR-007**: System MUST block saves on conflict and require the user to refresh before retrying.

### Key Entities *(include if feature involves data)*

- **Ticket Draft**: The user’s current edited content for a Redmine ticket, including modified fields and last known sync state.
- **Redmine Ticket**: The authoritative ticket record being updated by the save action.
- **Sync Result**: Outcome of a save attempt, including success/failure state and any conflict or error details.

### Assumptions

- Users are already authenticated and authorized to update the target Redmine ticket.
- Each editor instance maps to a single Redmine ticket.
- Save actions can be triggered manually or via editor auto-save behavior.

### Dependencies

- Availability of Redmine and the user’s permission to update the target ticket.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 95% of save actions that have changes update the Redmine ticket within 10 seconds.
- **SC-002**: 0% of failed save actions result in silent data loss of local edits.
- **SC-003**: At least 90% of users can complete a save and confirm the ticket is updated on the first attempt.
- **SC-004**: Support inquiries about "saved but not updated in Redmine" decrease by 50% within one release cycle.
