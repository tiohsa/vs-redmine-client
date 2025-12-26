# Feature Specification: Add Ticket Add Icon

**Feature Branch**: `001-add-ticket-icon`  
**Created**: 2025-12-27  
**Status**: Draft  
**Input**: User description: "チケット一覧のヘッダに新規チケット追加アイコンを追加する。"

## Clarifications

### Session 2025-12-27

- Q: 権限なしユーザーへの表示はどうする？ → A: アイコンは表示するが無効化し、説明ラベルを付ける
- Q: 既存の下書きがある場合の挙動は？ → A: 既存の下書きを表示（フォーカス）し、新規作成はしない
- Q: 権限変更が発生した場合の表示更新は？ → A: その時点の権限に合わせて即時に表示状態を更新する

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Start new ticket from list header (Priority: P1)

As a user viewing the ticket list, I can start creating a new ticket directly from the list header using a clear add icon.

**Why this priority**: This is the core value of the request and enables faster task creation without leaving the list view.

**Independent Test**: Can be fully tested by opening the ticket list and using the header icon to start a new ticket draft.

**Acceptance Scenarios**:

1. **Given** the user is viewing the ticket list, **When** they click the add icon in the header, **Then** a new ticket creation view opens.
2. **Given** the user is viewing the ticket list, **When** they hover the add icon, **Then** an accessible label is visible (e.g., tooltip or screen-reader text).

---

### User Story 2 - Permission-aware add icon (Priority: P2)

As a user without permission to create tickets, I get a clear indication that ticket creation is unavailable from the list header.

**Why this priority**: Prevents confusion and avoids failed actions for users who cannot create tickets.

**Independent Test**: Can be fully tested by simulating a user without create permission and verifying the icon state.

**Acceptance Scenarios**:

1. **Given** a user who cannot create tickets, **When** they view the ticket list header, **Then** the add icon is visible but disabled with an explanatory label.

---

### User Story 3 - No disruption to list browsing (Priority: P3)

As a user browsing the ticket list, the new icon does not interfere with existing header controls or list interactions.

**Why this priority**: Maintains the usability of the current list header while adding the new entry point.

**Independent Test**: Can be fully tested by interacting with existing header controls before and after the icon is present.

**Acceptance Scenarios**:

1. **Given** existing header actions are available, **When** the add icon is present, **Then** all existing actions remain usable and unchanged.

---

### Edge Cases

- What happens when the user clicks the add icon while a new ticket draft is already open? → Existing draft is shown/focused; no new draft is created.
- How does the system handle a user whose permissions change while the list is open? → The icon state updates immediately to match current permissions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a new ticket add icon in the ticket list header.
- **FR-002**: Clicking the add icon MUST initiate the same new ticket creation flow as the standard "new ticket" action.
- **FR-003**: The add icon MUST be accessible with a visible label or screen-reader text that describes its purpose.
- **FR-004**: Users without ticket creation permission MUST see the add icon visible but disabled with an explanatory label.
- **FR-005**: The add icon MUST NOT reduce or block access to existing header actions.
- **FR-006**: If a new ticket draft is already open, clicking the add icon MUST bring the existing draft into focus instead of creating another draft.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can start a new ticket from the list header in 2 or fewer interactions.
- **SC-002**: 95% of users who are allowed to create tickets can reach the new ticket creation view on the first attempt from the list header.
- **SC-003**: Users report no decrease in ability to use existing header actions after the icon is added (e.g., 0 regressions in usability feedback).

## Dependencies

- Existing new ticket creation flow is available from the list view.

## Assumptions

- The ticket list header already exists and is visible to users.
- A standard new ticket creation flow already exists and can be invoked from the list view.
- Permission rules for ticket creation already exist and should be respected by this icon.
