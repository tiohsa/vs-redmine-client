---

description: "Task list template for feature implementation"
---

# Tasks: チケット・コメント一覧のアイコンボタン化

**Input**: Design documents from `/specs/001-iconize-view-buttons/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Minimal setup alignment for this feature

- [x] T001 Verify quickstart steps and adjust if needed in specs/001-iconize-view-buttons/quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test helper used by all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Add view/title lookup helper for tests in src/test/helpers/packageJson.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 一覧操作をアイコンで認識する (Priority: P1) 🎯 MVP

**Goal**: チケット一覧・コメント一覧の操作ボタンがアイコン表示であることを保証する

**Independent Test**: view/title メニューにアイコン指定があることをテストで確認できる

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T003 [P] [US1] Assert tickets view title actions include icon and tooltip source in src/test/ticketsViewTitleActions.test.ts
- [x] T004 [P] [US1] Assert comments view title actions include icon and tooltip source in src/test/commentsViewTitleActions.test.ts

### Implementation for User Story 1

- [x] T005 [US1] Ensure view/title entries define icon and keep command titles for tooltip in package.json

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 追加ボタンがプラスで分かる (Priority: P2)

**Goal**: 追加ボタンがプラス（＋）アイコンであることを保証する

**Independent Test**: 追加ボタンの icon が `$(add)` であることをテストで確認できる

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T006 [P] [US2] Assert ticket add action icon is $(add) in src/test/ticketsViewTitleActions.test.ts
- [x] T007 [P] [US2] Assert comment add action icon is $(add) in src/test/commentsViewTitleActions.test.ts

### Implementation for User Story 2

- [x] T008 [US2] Set add action icons to $(add) in package.json

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 再読込ボタンが更新アイコンで分かる (Priority: P3)

**Goal**: 再読込ボタンが更新アイコンであることを保証する

**Independent Test**: 再読込ボタンの icon が `$(sync)` であることをテストで確認できる

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T009 [P] [US3] Assert ticket reload action icon is $(sync) in src/test/ticketsViewTitleActions.test.ts
- [x] T010 [P] [US3] Assert comment reload action icon is $(sync) in src/test/commentsViewTitleActions.test.ts

### Implementation for User Story 3

- [x] T011 [US3] Set reload action icons to $(sync) in package.json

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation and cleanup across stories

- [x] T012 [P] Record any quickstart adjustments after validation in specs/001-iconize-view-buttons/quickstart.md

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
- Tests before implementation changes in package.json

### Parallel Opportunities

- Tests for different views can be authored in parallel
- User Story 2 and 3 can proceed in parallel after Foundational is complete

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Assert tickets view title actions include icon and tooltip source in src/test/ticketsViewTitleActions.test.ts"
Task: "Assert comments view title actions include icon and tooltip source in src/test/commentsViewTitleActions.test.ts"
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

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
