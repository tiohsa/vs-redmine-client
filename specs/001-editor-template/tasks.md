# Tasks: 新規作成エディタのテンプレート設定

**Input**: Design documents from `/specs/001-editor-template/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Confirm current new-ticket editor creation flow in src/views/ticketPreview.ts and related tests

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T002 Add settings key for template file path in package.json
- [X] T003 Add settings accessor for template path in src/config/settings.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 新規作成テンプレートを設定する (Priority: P1) 🎯 MVP

**Goal**: テンプレートを設定し、新規作成エディタに初期値として反映できる

**Independent Test**: テンプレートファイルを指定すると、新規作成エディタの内容がテンプレートで始まる

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] [US1] Add unit tests for template file loading and absolute-path validation in src/test/ticketEditorTemplate.test.ts
- [X] T005 [P] [US1] Add unit tests for template application to new ticket editors in src/test/ticketPreview.test.ts

### Implementation for User Story 1

- [X] T006 [US1] Implement template file loading and validation in src/views/ticketPreview.ts
- [X] T007 [US1] Apply template body for new ticket editors only in src/views/ticketPreview.ts
- [X] T008 [US1] Show user-facing error and fall back to empty initial content when template is missing or invalid in src/views/ticketPreview.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - メタデータを含むテンプレートを使う (Priority: P2)

**Goal**: テンプレート内のメタデータと本文を初期値として反映できる

**Independent Test**: テンプレートのメタデータが新規作成エディタのメタデータ領域に反映される

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T009 [P] [US2] Add unit tests for parsing template metadata in src/test/ticketMetadataTemplate.test.ts

### Implementation for User Story 2

- [X] T010 [US2] Parse template metadata and description in src/views/ticketEditorContent.ts
- [X] T011 [US2] Apply parsed template metadata to new ticket editor content in src/views/ticketPreview.ts
- [X] T012 [US2] Ensure template overrides existing defaults in src/views/ticketPreview.ts

**Checkpoint**: User Story 2 should be fully functional and testable independently

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T013 [P] Update quickstart steps in specs/001-editor-template/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on user stories completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Can start after User Story 1 (depends on template loading)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Template loading before template application
- Metadata parsing before metadata application

### Parallel Opportunities

- T004 and T005 can run in parallel (different files)
- T009 can run in parallel with any US1 implementation tasks (different files)

---

## Parallel Example: User Story 1

```bash
# Launch tests in parallel:
Task: "Add unit tests for template file loading and absolute-path validation in src/test/ticketEditorTemplate.test.ts"
Task: "Add unit tests for template application to new ticket editors in src/test/ticketPreview.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run tests and confirm template is applied to new ticket editors

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deliver MVP
3. Add User Story 2 → Test independently
4. Validate quickstart steps

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
