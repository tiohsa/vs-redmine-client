# Feature Specification: Project List Sidebar

**Feature Branch**: `001-project-list-sidebar`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "Show Redmine project name list in the sidebar and display tickets for the selected project."

## User Scenarios & Testing *(mandatory)*

**Constitution reminder**: Unit tests are mandatory and must be defined before
implementation. Ensure scenarios can be covered by unit tests.

### User Story 1 - Browse Projects in Sidebar (Priority: P1)

As a developer, I want to see a list of Redmine projects in the sidebar so I can
select the correct project without leaving VS Code.

**Why this priority**: Project selection is required before any ticket browsing
can be meaningful.

**Independent Test**: A user can open the sidebar and see project names listed
without selecting a project.

**Acceptance Scenarios**:

1. **Given** the sidebar is opened, **When** the project list loads, **Then**
   available project names are displayed.
2. **Given** the user has access to no projects, **When** the list loads,
   **Then** an empty-state message is shown.

---

### User Story 2 - Show Tickets for Selected Project (Priority: P2)

As a developer, I want the ticket list to update when I select a project so I
can immediately work on that project’s tickets.

**Why this priority**: The main workflow depends on showing tickets for the
selected project.

**Independent Test**: A user selects a project and sees only that project’s
tickets in the ticket list.

**Acceptance Scenarios**:

1. **Given** a project is selected, **When** the ticket list loads, **Then**
   tickets for that project are shown.
2. **Given** the user switches to a different project, **When** the ticket list
   refreshes, **Then** the previous project’s tickets are replaced.

---

### Edge Cases

- What happens when the project list fails to load?
- How does the system handle a project with zero tickets?
- What happens when the user loses access to a previously selected project?

## Clarifications

### Session 2025-12-26

- Q: How should the project list be displayed relative to tickets? → A: Separate sidebar views for projects and tickets.
- Q: How is the project selection made? → A: Explicit user click selection.
- Q: Should the last selected project be remembered? → A: Yes, remember and preselect it.
- Q: How should the selected project be shown? → A: Highlight selection in the list.
- Q: What happens when project loading fails? → A: Show an error and allow retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a sidebar list of project names.
- **FR-002**: System MUST allow selecting a project from the list.
- **FR-002a**: System MUST switch projects only when the user selects one
  explicitly.
- **FR-003**: System MUST update the ticket list to show only tickets for the
  selected project.
- **FR-003a**: System MUST present project list and ticket list in separate
  sidebar views.
- **FR-003b**: System MUST remember the last selected project and preselect it
  on startup.
- **FR-003c**: System MUST highlight the selected project in the list without
  hiding other projects.
- **FR-004**: System MUST show a clear empty state when there are no projects
  or no tickets.
- **FR-005**: System MUST provide clear feedback when project or ticket loading
  fails.
- **FR-005a**: System MUST show an error message and allow retry when project
  list loading fails.

### Key Entities *(include if feature involves data)*

- **Project**: A Redmine project that can be selected in the sidebar.
- **Ticket**: A work item belonging to a selected project.
- **Project Selection**: The currently active project for ticket listing.

### Assumptions

- Users already have valid access to their Redmine instance.
- Project access permissions are managed outside the extension.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of project list loads complete within 3 seconds.
- **SC-002**: 95% of project selections update the ticket list within 3 seconds.
- **SC-003**: 90% of users can find and select the correct project without
  leaving VS Code.
- **SC-004**: User-reported confusion about project selection is under 5% per
  release.
