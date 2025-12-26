# Research: Project List Sidebar

## Decision 1: Sidebar layout
- Decision: Use separate sidebar views for project list and ticket list.
- Rationale: Matches clarified requirement and keeps selection clear.
- Alternatives considered: Nested tree with projects as parents (rejected due to
  mixed responsibilities in one view).

## Decision 2: Project selection behavior
- Decision: Switch projects only via explicit user click and highlight selection.
- Rationale: Prevents unexpected context changes and aligns with user control.
- Alternatives considered: Auto-selection based on recent activity.

## Decision 3: Remember last selection
- Decision: Persist and preselect the last chosen project on startup.
- Rationale: Reduces repeated selection steps for daily workflows.
- Alternatives considered: Always prompt on startup.

## Decision 4: Error handling
- Decision: Show an error message and allow retry when project loading fails.
- Rationale: Gives users immediate feedback and recovery path.
- Alternatives considered: Silent empty state.
