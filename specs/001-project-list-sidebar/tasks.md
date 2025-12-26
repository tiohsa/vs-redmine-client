---

description: "Task list template for feature implementation"
---

# Tasks: Project List Sidebar

**Input**: Design documents from `/specs/001-project-list-sidebar/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Add project list view registration in `package.json`
- [x] T002 [P] Add project list view settings for selection persistence in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement project selection persistence helper in `src/config/projectSelection.ts`
- [x] T004 Implement projects API wrapper (list projects) in `src/redmine/projects.ts`
- [x] T005 Implement shared empty/error state helper for tree views in `src/views/viewState.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Browse Projects in Sidebar (Priority: P1) 🎯 MVP

**Goal**: Show Redmine project list in a dedicated sidebar view with selection highlight.

**Independent Test**: User can open the project view, see project names, and
observe a highlight on the selected project.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [P] [US1] Add tests for project list rendering in `src/test/projectsView.test.ts`
- [x] T007 [P] [US1] Add tests for selected project highlight behavior in `src/test/projectSelection.test.ts`
- [x] T008 [P] [US1] Add tests for empty-state rendering in `src/test/projectsEmptyState.test.ts`

### Implementation for User Story 1

- [x] T009 [P] [US1] Implement projects tree provider in `src/views/projectsView.ts`
- [x] T010 [US1] Wire project view registration and selection handling in `src/extension.ts`
- [x] T011 [US1] Integrate empty/error state handling in `src/views/projectsView.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Show Tickets for Selected Project (Priority: P2)

**Goal**: Update ticket list based on selected project.

**Independent Test**: User selects a project and ticket list refreshes to show
only tickets for that project.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T012 [P] [US2] Add tests for ticket list refresh on project selection in `src/test/ticketsByProject.test.ts`
- [x] T013 [P] [US2] Add tests for empty ticket list state in `src/test/ticketsEmptyState.test.ts`

### Implementation for User Story 2

- [x] T014 [US2] Update ticket list provider to use selected project in `src/views/ticketsView.ts`
- [x] T015 [US2] Wire project selection to ticket list refresh in `src/extension.ts`
- [x] T016 [US2] Add empty-state messaging for zero tickets in `src/views/ticketsView.ts`

**Checkpoint**: User Story 2 should be independently functional and testable

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T017 [P] Update quickstart with project list view usage in `specs/001-project-list-sidebar/quickstart.md`
- [x] T018 [P] Update README with project list sidebar details in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on project selection

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- All tests for a user story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add tests for project list rendering in src/test/projectsView.test.ts"
Task: "Add tests for selected project highlight behavior in src/test/projectSelection.test.ts"
Task: "Add tests for empty-state rendering in src/test/projectsEmptyState.test.ts"

# Launch core implementation tasks for User Story 1 together:
Task: "Implement projects tree provider in src/views/projectsView.ts"
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
4. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
