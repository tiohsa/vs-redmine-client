---

description: "Task list for Activity Bar専用一覧ビュー"
---

# Tasks: Activity Bar専用一覧ビュー

**Input**: Design documents from `/specs/001-activitybar-view/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Update Activity Bar view container contributions in `package.json`
- [X] T002 Update activationEvents for Activity Bar views in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add shared view ID constants for explorer/activity views in `src/views/viewIds.ts`
- [X] T004 Register Activity Bar tree views using shared providers in `src/extension.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Activity Barから一覧を確認 (Priority: P1) 🎯 MVP

**Goal**: Activity Barの専用画面で、エクスプローラーと同じ階層・並びの一覧を表示できる。

**Independent Test**: Activity Barの各ビューが登録され、プロジェクト／チケット／コメント一覧が表示されることを確認できる。

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T005 [P] [US1] Add view registration test for Activity Bar views in `src/test/activityBarViews.test.ts`
- [X] T006 [P] [US1] Add list rendering smoke test for Activity Bar views in `src/test/activityBarLists.test.ts`

### Implementation for User Story 1

- [X] T007 [US1] Add Activity Bar view container metadata (id, title, icon) in `package.json`
- [X] T008 [US1] Add Activity Bar view entries for projects/tickets/comments in `package.json`
- [X] T009 [US1] Wire Activity Bar views to existing providers in `src/extension.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 専用画面で一覧の最新状態を確認 (Priority: P2)

**Goal**: 専用画面の一覧がフォーカス時に更新され、エクスプローラーと同じ内容を維持する。

**Independent Test**: Activity Barを開くたびに更新され、同条件でエクスプローラーと同じ一覧が表示されることを確認できる。

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T010 [P] [US2] Add focus refresh test for Activity Bar views in `src/test/activityBarRefresh.test.ts`
- [X] T011 [P] [US2] Add data parity test between explorer and Activity Bar in `src/test/activityBarParity.test.ts`

### Implementation for User Story 2

- [X] T012 [US2] Refresh providers when Activity Bar views gain focus in `src/extension.ts`
- [X] T013 [US2] Ensure shared provider state is reused across explorer/activity views in `src/views/projectsView.ts`, `src/views/ticketsView.ts`, `src/views/commentsView.ts`

**Checkpoint**: User Story 2 should be independently functional and testable

---

## Phase 5: User Story 3 - データがない場合でも迷わない (Priority: P3)

**Goal**: 空状態や取得失敗時でも、一覧ごとの状態が明確に表示される。

**Independent Test**: 各一覧で空状態メッセージが出し分けられ、取得失敗時に開発者向け詳細が表示されることを確認できる。

### Tests for User Story 3 (MANDATORY) ⚠️

- [X] T014 [P] [US3] Add per-list empty state test for Activity Bar views in `src/test/activityBarEmptyState.test.ts`
- [X] T015 [P] [US3] Add error detail display test for Activity Bar views in `src/test/activityBarErrorState.test.ts`

### Implementation for User Story 3

- [X] T016 [US3] Add per-list empty state messages in `src/views/projectsView.ts`, `src/views/ticketsView.ts`, `src/views/commentsView.ts`
- [X] T017 [US3] Include developer detail text in error state items in `src/views/projectsView.ts`, `src/views/ticketsView.ts`, `src/views/commentsView.ts`, `src/views/viewState.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T018 [P] Cap list rendering to 2,000 items in `src/views/projectsView.ts`, `src/views/ticketsView.ts`, `src/views/commentsView.ts`
- [X] T019 Validate quickstart steps in `/home/glorydays/projects/src/ts/todoex/specs/001-activitybar-view/quickstart.md`

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Reuses US1 view wiring
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Reuses US1 view wiring

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- View registration before view behavior changes
- State/behavior before polish

### Parallel Opportunities

- T005 and T006 can run in parallel
- T010 and T011 can run in parallel
- T014 and T015 can run in parallel
- T016 and T017 can run in parallel
- T018 can run in parallel with other stories once their providers are in place

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add view registration test for Activity Bar views in src/test/activityBarViews.test.ts"
Task: "Add list rendering smoke test for Activity Bar views in src/test/activityBarLists.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Test independently → Demo
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
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
