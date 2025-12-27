---

description: "Task list template for feature implementation"
---

# Tasks: 親子関係ツリー表示

**Input**: Design documents from `/home/glorydays/projects/src/ts/todoex/specs/001-tree-view-hierarchy/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: User stories include test tasks. Tests are REQUIRED for each user story and must be written before implementation (Constitution: TDD).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared helpers and fixtures used across stories

- [X] T001 Create tree view model types in /home/glorydays/projects/src/ts/todoex/src/views/treeTypes.ts
- [X] T002 [P] Create tree test fixtures in /home/glorydays/projects/src/ts/todoex/src/test/helpers/treeFixtures.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core tree utilities that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Add expansion state unit tests in /home/glorydays/projects/src/ts/todoex/src/test/treeState.test.ts
- [X] T004 [P] Add tree builder unit tests in /home/glorydays/projects/src/ts/todoex/src/test/treeBuilder.test.ts
- [X] T005 Implement expansion state store in /home/glorydays/projects/src/ts/todoex/src/views/treeState.ts (depends on T003)
- [X] T006 Implement tree builder with cycle detection in /home/glorydays/projects/src/ts/todoex/src/views/treeBuilder.ts (depends on T001, T004)
- [X] T007 [P] Add warning tree item helper in /home/glorydays/projects/src/ts/todoex/src/views/treeWarnings.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - プロジェクト階層を一目で把握 (Priority: P1) 🎯 MVP

**Goal**: プロジェクト一覧で親子関係がツリーとして表示される。

**Independent Test**: 親子関係があるプロジェクト一覧を読み込んだ際、親子がツリー構造として表示される。

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T008 [P] [US1] Add projects tree view tests in /home/glorydays/projects/src/ts/todoex/src/test/projectsTreeView.test.ts

### Implementation for User Story 1

- [X] T009 [US1] Update project tree item construction to use tree builder in /home/glorydays/projects/src/ts/todoex/src/views/projectsView.ts (depends on T006)
- [X] T010 [US1] Add project tree expand state handling in /home/glorydays/projects/src/ts/todoex/src/views/projectsView.ts (depends on T005)
- [X] T011 [US1] Surface cycle warning items for projects in /home/glorydays/projects/src/ts/todoex/src/views/projectsView.ts (depends on T007)

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - チケット階層を一目で把握 (Priority: P2)

**Goal**: チケット一覧で親子関係がツリーとして表示される。

**Independent Test**: 親子関係があるチケット一覧を読み込んだ際、親子がツリー構造として表示される。

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T012 [P] [US2] Add tickets tree view tests in /home/glorydays/projects/src/ts/todoex/src/test/ticketsTreeView.test.ts

### Implementation for User Story 2

- [X] T013 [US2] Update ticket tree item construction to use tree builder in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts (depends on T006)
- [X] T014 [US2] Add ticket tree expand state handling in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts (depends on T005)
- [X] T015 [US2] Surface cycle warning items for tickets in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts (depends on T007)

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 必要な階層だけに絞り込む (Priority: P3)

**Goal**: ツリーの開閉で必要な範囲だけを表示できる。

**Independent Test**: 子要素を持つ項目を開閉すると、配下が表示・非表示になる。

### Tests for User Story 3 (MANDATORY) ⚠️

- [X] T016 [P] [US3] Add expand/collapse interaction tests in /home/glorydays/projects/src/ts/todoex/src/test/treeExpandCollapse.test.ts

### Implementation for User Story 3

- [X] T017 [US3] Wire expand/collapse events for projects and tickets in /home/glorydays/projects/src/ts/todoex/src/extension.ts (depends on T005)
- [X] T018 [US3] Handle expand/collapse state updates in /home/glorydays/projects/src/ts/todoex/src/views/projectsView.ts (depends on T005)
- [X] T019 [US3] Handle expand/collapse state updates in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts (depends on T005)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T020 [P] Add cycle warning behavior tests in /home/glorydays/projects/src/ts/todoex/src/test/treeWarnings.test.ts
- [X] T021 Update documentation note for tree behavior in /home/glorydays/projects/src/ts/todoex/specs/001-tree-view-hierarchy/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on US1
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on shared tree state (T005)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Shared helpers before view-specific integration
- Story complete before moving to next priority

### Parallel Opportunities

- Setup tasks marked [P] can run in parallel
- Foundational tests (T003, T004) can run in parallel
- After Foundational completes, US1/US2 tests can start in parallel

---

## Parallel Example: User Story 1

```bash
Task: "T008 [US1] Add projects tree view tests in /home/glorydays/projects/src/ts/todoex/src/test/projectsTreeView.test.ts"
Task: "T009 [US1] Update project tree item construction in /home/glorydays/projects/src/ts/todoex/src/views/projectsView.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T012 [US2] Add tickets tree view tests in /home/glorydays/projects/src/ts/todoex/src/test/ticketsTreeView.test.ts"
Task: "T013 [US2] Update ticket tree item construction in /home/glorydays/projects/src/ts/todoex/src/views/ticketsView.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T016 [US3] Add expand/collapse interaction tests in /home/glorydays/projects/src/ts/todoex/src/test/treeExpandCollapse.test.ts"
Task: "T017 [US3] Wire expand/collapse events in /home/glorydays/projects/src/ts/todoex/src/extension.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run tests for User Story 1
5. Demo MVP if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo (MVP)
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Test independently → Demo

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
