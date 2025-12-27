---

description: "Task list for Project List Settings Panel"
---

# Tasks: Project List Settings Panel

**Input**: Design documents from `/specs/001-add-settings-panel/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are required by the constitution and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create settings state module with defaults and helper types in /home/glorydays/projects/src/ts/todoex/src/views/projectListSettings.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Add settings state to tickets view storage in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T003 Wire settings state into ticket list render flow in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T004 [P] Align settings state shape with contract in /home/glorydays/projects/src/ts/todoex/specs/001-add-settings-panel/contracts/settings.openapi.yaml

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Filters and Sorting (Priority: P1) 🎯 MVP

**Goal**: Users can filter and sort the project list by priority, status, tracker, and assignee, with reset to defaults.

**Independent Test**: Filter and sort settings update the list immediately, including reset behavior.

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T005 [P] [US1] Add filter combination tests (field OR, cross-field AND) in /home/glorydays/projects/src/ts/todoex/src/test/ticketsSettingsFilters.test.ts
- [x] T006 [P] [US1] Add sort order tests for priority/status/tracker/assignee in /home/glorydays/projects/src/ts/todoex/src/test/ticketsSettingsSorting.test.ts

### Implementation for User Story 1

- [x] T007 [P] [US1] Add filter controls (priority/status/tracker/assignee, including Unassigned) in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T008 [US1] Implement filter application logic using settings state in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T009 [US1] Implement sort application logic and direction handling in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T010 [US1] Implement reset action to defaults in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts

**Checkpoint**: User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - Control Due Date Display (Priority: P2)

**Goal**: Users can toggle due date display windows with closest-window priority.

**Independent Test**: Due date indicators follow toggles and show only the closest applicable window.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T011 [P] [US2] Add due date display toggle and priority tests in /home/glorydays/projects/src/ts/todoex/src/test/ticketsDueDateDisplay.test.ts

### Implementation for User Story 2

- [x] T012 [P] [US2] Add due date display toggles to settings UI in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T013 [US2] Implement closest-window indicator logic in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts

**Checkpoint**: User Story 2 is functional and testable independently

---

## Phase 5: User Story 3 - Review and Adjust Settings in Place (Priority: P3)

**Goal**: Users can see current settings and adjust them without leaving the project list.

**Independent Test**: Settings area is visible above the list and changes update the list without navigation.

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T014 [P] [US3] Add settings panel visibility and live-update tests in /home/glorydays/projects/src/ts/todoex/src/test/ticketsSettingsPanel.test.ts

### Implementation for User Story 3

- [x] T015 [US3] Render settings panel above the ticket list with current selections in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T016 [US3] Ensure list updates immediately on settings changes in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts

**Checkpoint**: All user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T017 [P] Update quickstart validation notes to reflect final behavior in /home/glorydays/projects/src/ts/todoex/specs/001-add-settings-panel/quickstart.md
- [x] T018 Refine settings UI copy for clarity in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts
- [x] T019 [P] Add focused regression coverage for tickets view in /home/glorydays/projects/src/ts/todoex/src/test/ticketsViewPermissions.test.ts
- [x] T020 Run quickstart.md checklist and reconcile any gaps in /home/glorydays/projects/src/ts/todoex/specs/001-add-settings-panel/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- UI state scaffolding before behavior wiring
- Core implementation before polish
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch filter and sort tests together:
Task: "Add filter combination tests (field OR, cross-field AND) in /home/glorydays/projects/src/ts/todoex/src/test/ticketsSettingsFilters.test.ts"
Task: "Add sort order tests for priority/status/tracker/assignee in /home/glorydays/projects/src/ts/todoex/src/test/ticketsSettingsSorting.test.ts"

# Launch UI control additions in parallel (different sections of the same file are NOT parallel-safe):
Task: "Add filter controls (priority/status/tracker/assignee, including Unassigned) in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
