# Phase 0 Research: Project List Settings Panel

## Decision 1: Filter Combination Logic
- **Decision**: Within each field, selected values are ORed; across fields, selections are ANDed.
- **Rationale**: Aligns with common filter UX and keeps results predictable when combining multiple fields.
- **Alternatives considered**: All-AND across every value; field-OR only.

## Decision 2: Due Date Display Priority
- **Decision**: Show only the closest due date window (1 day > 3 days > 7 days > overdue).
- **Rationale**: Avoids multiple indicators and highlights the most urgent window.
- **Alternatives considered**: Show all matching indicators; always prioritize overdue.

## Decision 3: Reset Behavior
- **Decision**: Reset restores defaults (all filters selected, no sort, all due date displays enabled).
- **Rationale**: Provides a clear, consistent baseline and matches existing assumptions.
- **Alternatives considered**: Clear all; revert to last saved state.

## Decision 4: Assignee Filter for Unassigned
- **Decision**: Include an explicit “Unassigned” option in the assignee filter.
- **Rationale**: Supports triage of unassigned work without losing visibility.
- **Alternatives considered**: Always exclude unassigned; always include unassigned.

## Decision 5: Role-Based Behavior
- **Decision**: Use a single shared behavior for all users; no role-based differences.
- **Rationale**: Avoids unnecessary branching not required by the spec.
- **Alternatives considered**: Role-gated settings; role-specific defaults.
