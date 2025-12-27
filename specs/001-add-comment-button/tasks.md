---

description: "Task list template for feature implementation"
---

# Tasks: Add Comment Add Button

**Input**: Design documents from `/specs/001-add-comment-button/`
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

- [x] T001 Add package.json helper reuse in `src/test/helpers/packageJson.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add comment permission context tests in `src/test/commentsViewContext.test.ts`
- [x] T003 Add comment view context helpers in `src/views/commentViewContext.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Add comment from comments header (Priority: P1) 🎯 MVP

**Goal**: Provide a comments header add button that starts the existing add comment flow.

**Independent Test**: A package.json-driven test confirms the header action exists and triggers the intended command without affecting other comment actions.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T004 [P] [US1] Add comments header menu tests in `src/test/commentsViewTitleActions.test.ts`

### Implementation for User Story 1

- [x] T005 [P] [US1] Add add-comment command + view/title menu entry in `package.json`
- [x] T006 [US1] Register comments header command in `src/extension.ts`
- [x] T007 [US1] Implement comments header command wrapper in `src/commands/addCommentFromList.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - Permission-aware add comment button (Priority: P2)

**Goal**: Show the add button disabled with an explanatory label for users without comment permission, updating immediately when permission changes.

**Independent Test**: A unit test verifies the permission context key is set and the menu enablement uses it.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T008 [P] [US2] Add permission context tests in `src/test/commentsViewPermissions.test.ts`

### Implementation for User Story 2

- [x] T009 [P] [US2] Add permission evaluation helper in `src/views/commentsView.ts`
- [x] T010 [US2] Update `src/views/commentsView.ts` to refresh the permission context key on load/refresh
- [x] T011 [US2] Update view/title menu enablement in `package.json`

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - No disruption to existing comment actions (Priority: P3)

**Goal**: Ensure existing comment actions remain unchanged and usable alongside the new button.

**Independent Test**: A regression test confirms no changes to existing comment actions or item context menus.

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T012 [P] [US3] Add regression test for existing menus in `src/test/commentsViewTitleActions.test.ts`

### Implementation for User Story 3

- [x] T013 [US3] Verify header action grouping/order in `package.json`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T014 [P] Run quickstart validation steps in `/home/glorydays/projects/src/ts/todoex/specs/001-add-comment-button/quickstart.md`

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
- T004 can run in parallel with T005
- T008 can run in parallel with T009

---

## Parallel Example: User Story 1

```bash
# Launch required tests for User Story 1:
Task: "Add comments header menu tests in src/test/commentsViewTitleActions.test.ts"

# Launch implementation tasks that do not conflict:
Task: "Add add-comment command + view/title menu entry in package.json"
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
