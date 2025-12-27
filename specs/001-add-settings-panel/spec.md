# Feature Specification: Project List Settings Panel

**Feature Branch**: `001-add-settings-panel`  
**Created**: 2025-12-27  
**Status**: Draft  
**Input**: User description: "拡張機能のプロジェクト一覧の上に設定エリアを設ける。設定内容はredmineのチケットの優先度、ステータス、トラッカー、担当のフィルタ設定、優先度、ステータス、トラッカー、担当の並び替え設定。期日が７日以内、３日以内、１日以内、期限切れの表示設定。"

## Clarifications

### Session 2025-12-27

- Q: How should multiple filter selections combine across fields? → A: Within each field use OR; across fields use AND.
- Q: When multiple due date windows apply, how should display be prioritized? → A: Show only the closest due date window (1 day > 3 days > 7 days > overdue).
- Q: What should the reset action restore? → A: Restore defaults (all filters selected, no sort, all due date displays enabled).
- Q: How should unassigned tickets be handled in the assignee filter? → A: Include an explicit “Unassigned” option in the assignee filter.
- Q: Should settings behavior vary by user role? → A: Use a single shared behavior for all users; no role-based differences.

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Configure Filters and Sorting (Priority: P1)

A user adjusts ticket filters and sorting from a settings area placed above the project list to focus on relevant tickets.

**Why this priority**: Filtering and sorting directly affect daily ticket triage and are the primary value of the settings area.

**Independent Test**: Can be fully tested by applying filter and sort selections and confirming the project list updates accordingly.

**Acceptance Scenarios**:

1. **Given** a project list with mixed priorities, statuses, trackers, and assignees, **When** the user selects filter values for those fields, **Then** tickets are included when they match any selected value within a field and match all fields that have selections.
2. **Given** a project list with mixed values, **When** the user selects a sort field and direction, **Then** tickets are ordered according to the selected sort settings.
3. **Given** active filters, **When** the user clears filters, **Then** the list returns to showing all tickets.

---

### User Story 2 - Control Due Date Display (Priority: P2)

A user configures which due date windows are visually highlighted in the project list.

**Why this priority**: Due date visibility guides time-sensitive work and is a frequent decision point.

**Independent Test**: Can be fully tested by toggling due date display options and confirming indicators appear or disappear as expected.

**Acceptance Scenarios**:

1. **Given** tickets with due dates within 7, 3, and 1 days, **When** the user enables or disables each window, **Then** only the chosen windows are visually highlighted.
2. **Given** tickets with overdue due dates, **When** the user disables the overdue display, **Then** overdue indicators are not shown.

---

### User Story 3 - Review and Adjust Settings in Place (Priority: P3)

A user can see current settings and adjust them without leaving the project list.

**Why this priority**: Quick visibility and adjustment reduce context switching during ticket review.

**Independent Test**: Can be fully tested by verifying the settings area displays current selections and can be changed in place.

**Acceptance Scenarios**:

1. **Given** the project list view is open, **When** the user looks at the settings area, **Then** the current filter, sort, and due date display selections are visible.
2. **Given** the settings area is visible, **When** the user changes any setting, **Then** the project list updates without navigating away.

---

### Edge Cases

- No tickets match the selected filters and the list should show an empty state.
- Tickets without a due date should remain visible and have no due date indicators.
- Tickets missing a sort field value should be placed consistently (e.g., grouped at the end).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a settings area above the project list.
- **FR-002**: The settings area MUST allow filtering tickets by priority, status, tracker, and assignee.
- **FR-003**: The project list MUST include tickets that match any selected value within a field and match all fields with active selections.
- **FR-003a**: The assignee filter MUST include an explicit “Unassigned” option.
- **FR-004**: The settings area MUST allow sorting tickets by priority, status, tracker, or assignee with a chosen direction.
- **FR-005**: The project list MUST reflect the active sort settings.
- **FR-006**: The settings area MUST allow toggling display for due date windows of within 7 days, within 3 days, within 1 day, and overdue.
- **FR-007**: Due date display settings MUST affect visual indicators only and MUST NOT filter tickets out of the list.
- **FR-008**: The settings area MUST show the currently active filter, sort, and due date display selections.
- **FR-009**: When multiple due date windows apply, the system MUST show only the closest due date window (1 day, then 3 days, then 7 days, then overdue).

### Assumptions

- Settings apply to the current project list view only and do not change backend data.
- Defaults include all filter values selected, no explicit sort selection, and all due date display options enabled.
- Only one sort field and direction are active at a time.
- A reset action restores the default settings.
- The settings behavior is consistent across users without role-based variations.

### Key Entities *(include if feature involves data)*

- **Filter Selection**: The chosen values for priority, status, tracker, and assignee that determine which tickets appear.
- **Sort Preference**: The selected field and direction used to order the ticket list.
- **Due Date Display Rule**: The enabled or disabled visibility options for due date windows and overdue status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tickets shown in a test dataset match the active filter selections.
- **SC-002**: 100% of tickets in a test dataset appear in the order defined by the active sort settings.
- **SC-003**: At least 90% of users in a usability check can locate and change a setting without assistance on the first attempt.
- **SC-004**: Users can configure filters, sorting, and due date display in under 2 minutes during a guided task.
