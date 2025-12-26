---

description: "Task list template for feature implementation"
---

# Tasks: Add Ticket Add Icon

**Input**: Design documents from `/specs/001-add-ticket-icon/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths shown below assume single project - adjust based on plan.md structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create package.json test helper in `src/test/helpers/packageJson.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add unit tests for view context helpers in `src/test/viewContext.test.ts`
- [x] T003 Add view context helpers (set/get enablement keys) in `src/views/viewContext.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Start new ticket from list header (Priority: P1) 🎯 MVP

**Goal**: Provide a header add icon that starts the existing new-ticket flow from the ticket list.

**Independent Test**: A package.json-driven test confirms the header action exists and triggers the intended command without affecting other header actions.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T004 [P] [US1] Add header menu contribution tests in `src/test/ticketsViewTitleActions.test.ts`
- [x] T005 [P] [US1] Add draft-focus helper tests in `src/test/ticketEditorRegistry.test.ts`

### Implementation for User Story 1

- [x] T006 [P] [US1] Add add-icon command + view/title menu entry in `package.json`
- [x] T007 [US1] Register list header command in `src/extension.ts`
- [x] T008 [US1] Implement list header command wrapper in `src/commands/createTicketFromList.ts`
- [x] T009 [US1] Add draft-focus helper in `src/views/ticketEditorRegistry.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - Permission-aware add icon (Priority: P2)

**Goal**: Show the add icon disabled with an explanatory label for users without create permission, updating immediately when permission changes.

**Independent Test**: A unit test verifies the permission context key is set and the menu enablement uses it.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T010 [P] [US2] Add permission context tests in `src/test/ticketsViewPermissions.test.ts`

### Implementation for User Story 2

- [x] T011 [P] [US2] Add permission evaluation helper in `src/views/ticketsView.ts`
- [x] T012 [US2] Update `src/views/ticketsView.ts` to refresh the permission context key on load/refresh
- [x] T013 [US2] Update view/title menu enablement in `package.json`

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - No disruption to list browsing (Priority: P3)

**Goal**: Ensure existing header actions remain unchanged and usable alongside the new icon.

**Independent Test**: A regression test confirms no changes to existing header actions or item context menus.

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T014 [P] [US3] Add regression test for existing menus in `src/test/ticketsViewTitleActions.test.ts`

### Implementation for User Story 3

- [x] T015 [US3] Verify header action grouping/order in `package.json`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T016 [P] Run quickstart validation steps in `/home/glorydays/projects/src/ts/todoex/specs/001-add-ticket-icon/quickstart.md`

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on the menu entry from US1
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Verifies behavior after US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Helper utilities before command wiring
- Menu contributions before runtime validation
- Story complete before moving to next priority

### Parallel Opportunities

- T001 can run in parallel with T002
- T004 and T005 can run in parallel
- T006 can run in parallel with T009
- T010 can run in parallel with T011

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add header menu contribution tests in src/test/ticketsViewTitleActions.test.ts"
Task: "Add draft-focus helper tests in src/test/ticketEditorRegistry.test.ts"

# Launch implementation tasks that do not conflict:
Task: "Add add-icon command + view/title menu entry in package.json"
Task: "Add draft-focus helper in src/views/ticketEditorRegistry.ts"
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

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
