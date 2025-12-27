# Tasks: 保存済み状態でのエディタ表示

**Input**: Design documents from `/specs/001-show-saved-editor/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for this feature (TDD).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Extend test helpers with saved/draft/reload fixtures in src/test/helpers/editorStubs.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T002 Update editor type definitions to include display source and lastLoadedAt in src/views/ticketEditorTypes.ts
- [X] T003 Update shared view state to carry editor display metadata in src/views/viewState.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 保存済み内容の即時表示 (Priority: P1) 🎯 MVP

**Goal**: 選択時は下書き優先で表示し、Reloadで保存済み内容に同期する。

**Independent Test**: チケット/コメントの選択で下書き優先表示、Reload成功で保存済み内容に置換、Reload失敗で内容保持が確認できる。

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T004 [P] [US1] Add draft-vs-saved selection tests for tickets in src/test/ticketEditorContent.test.ts
- [X] T005 [P] [US1] Add draft-vs-saved selection tests for comments in src/test/commentEdit.test.ts
- [X] T006 [P] [US1] Add reload-overwrite tests for tickets in src/test/ticketSaveSync.test.ts
- [X] T007 [P] [US1] Add reload-overwrite tests for comments in src/test/commentSaveSync.test.ts
- [X] T008 [P] [US1] Add reload-failure-keeps-content tests in src/test/ticketSaveSync.test.ts

### Implementation for User Story 1

- [X] T009 [US1] Prefer draft content on ticket selection and set display source in src/views/ticketEditorContent.ts
- [X] T010 [US1] Prefer draft content on comment selection and set display source in src/views/commentEditStore.ts
- [X] T011 [US1] Add reload sync flow for tickets (fetch saved, overwrite editor, failure handling) in src/views/ticketSaveSync.ts
- [X] T012 [US1] Add reload sync flow for comments (fetch saved, overwrite editor, failure handling) in src/views/commentSaveSync.ts
- [X] T013 [US1] Wire reload command for tickets in src/commands/reloadTicket.ts
- [X] T014 [US1] Wire reload command for comments in src/commands/reloadComment.ts
- [X] T015 [US1] Register reload commands and view actions in src/extension.ts
- [X] T016 [US1] Add reload actions to ticket/comment views in src/views/ticketsView.ts
- [X] T017 [US1] Add reload actions to ticket/comment views in src/views/commentsView.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple behaviors

- [X] T018 [P] Update quickstart verification notes if needed in specs/001-show-saved-editor/quickstart.md
- [X] T019 [P] Update openapi documentation notes if needed in specs/001-show-saved-editor/contracts/openapi.yaml

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3)**: Depends on Foundational phase completion
- **Polish (Phase 4)**: Depends on User Story 1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within User Story 1

- Tests MUST be written and FAIL before implementation
- Selection/display logic before reload wiring
- Reload logic before command/view wiring

### Parallel Opportunities

- T004-T008 can run in parallel (different test files)
- T013-T014 can run in parallel (different command files)
- T016-T017 can run in parallel (different view files)

---

## Parallel Example: User Story 1

```bash
# Tests in parallel
Task: "Add draft-vs-saved selection tests for tickets in src/test/ticketEditorContent.test.ts"
Task: "Add draft-vs-saved selection tests for comments in src/test/commentEdit.test.ts"
Task: "Add reload-overwrite tests for tickets in src/test/ticketSaveSync.test.ts"
Task: "Add reload-overwrite tests for comments in src/test/commentSaveSync.test.ts"

# Command wiring in parallel
Task: "Wire reload command for tickets in src/commands/reloadTicket.ts"
Task: "Wire reload command for comments in src/commands/reloadComment.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 with unit tests

### Incremental Delivery

- This feature is a single story; deliver after Phase 3 and polish as needed.
