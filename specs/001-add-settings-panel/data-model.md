# Phase 1 Data Model: Project List Settings Panel

## Entities

### Settings State
- **Description**: Aggregate of all settings that affect the project list view.
- **Fields**:
  - `filterSelection`
  - `sortPreference`
  - `dueDateDisplayRule`
- **Relationships**: Composes the three entities below.

### Filter Selection
- **Description**: User-selected filter values for ticket listing.
- **Fields**:
  - `priorities`: collection of priority values
  - `statuses`: collection of status values
  - `trackers`: collection of tracker values
  - `assignees`: collection of assignee identifiers
  - `includeUnassigned`: boolean flag
- **Validation Rules**:
  - When a field has selections, tickets match any value within the field.
  - Across fields, tickets must satisfy all fields with selections.

### Sort Preference
- **Description**: User-selected sort ordering for the ticket list.
- **Fields**:
  - `field`: one of priority, status, tracker, assignee
  - `direction`: ascending or descending
- **Validation Rules**:
  - Only one sort field and direction are active at a time.

### Due Date Display Rule
- **Description**: User-selected visibility for due date windows and overdue indicators.
- **Fields**:
  - `showWithin7Days`: boolean
  - `showWithin3Days`: boolean
  - `showWithin1Day`: boolean
  - `showOverdue`: boolean
  - `priorityOrder`: fixed order (1 day > 3 days > 7 days > overdue)
- **Validation Rules**:
  - If multiple windows apply, only the closest window is displayed.

## State Transitions

- Settings state updates when the user changes any filter, sort, or display option.
- Reset returns all fields to default values.
