# Tasks: エディタ初期値設定

**Input**: Design documents from `/specs/001-editor-default-value/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: ユニットテスト必須（Constitution準拠）。各ユーザーストーリーでテストを先に作成する。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Add editor default settings keys to configuration schema in src/config/settings.ts
- [X] T002 [P] Add editor default value types in src/views/ticketEditorTypes.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Create in-memory defaults store in src/views/ticketEditorDefaultsStore.ts
- [X] T004 [P] Add defaults validation helper in src/views/ticketEditorDefaultsValidation.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 初期値を反映して新規登録を開始 (Priority: P1) 🎯 MVP

**Goal**: 設定画面で初期値を保存し、新規登録エディタに自動反映する。

**Independent Test**: 初期値を設定して新規登録を開き、設定した項目に初期値が反映される。

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T005 [P] [US1] Add unit test for saving defaults in src/test/ticketSettingsDefaultsSave.test.ts
- [X] T006 [P] [US1] Add unit test for applying defaults on new ticket in src/test/ticketEditorDefaultsApply.test.ts

### Implementation for User Story 1

- [X] T007 [US1] Implement defaults save handling in src/views/ticketSettingsView.ts
- [X] T008 [US1] Apply defaults when creating new drafts in src/views/ticketDraftStore.ts
- [X] T009 [US1] Render applied defaults in editor content in src/views/ticketEditorContent.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 初期値の変更とリセット (Priority: P2)

**Goal**: 初期値を変更・リセットし、次回の新規登録に反映する。

**Independent Test**: 変更・リセット後に新規登録を開き、更新値または空欄が反映される。

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T010 [P] [US2] Add unit test for updating defaults in src/test/ticketSettingsDefaultsUpdate.test.ts
- [X] T011 [P] [US2] Add unit test for reset-to-blank behavior in src/test/ticketSettingsDefaultsReset.test.ts

### Implementation for User Story 2

- [X] T012 [US2] Implement defaults update flow in src/views/ticketSettingsView.ts
- [X] T013 [US2] Implement reset-to-blank action in src/views/ticketSettingsView.ts
- [X] T014 [US2] Support reset-to-blank in src/views/ticketEditorDefaultsStore.ts

**Checkpoint**: User Stories 1 and 2 should both work independently

---

## Phase 5: User Story 3 - 初期値設定の確認 (Priority: P3)

**Goal**: 設定画面で現在の初期値を確認できる。

**Independent Test**: 設定画面を開くと保存済みの初期値が表示される。

### Tests for User Story 3 (MANDATORY) ⚠️

- [X] T015 [P] [US3] Add unit test for displaying current defaults in src/test/ticketSettingsDefaultsDisplay.test.ts

### Implementation for User Story 3

- [X] T016 [US3] Load and display current defaults on settings open in src/views/ticketSettingsView.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T017 [P] Update validation notes for defaults in specs/001-editor-default-value/quickstart.md
- [ ] T018 Run quickstart verification steps and record results in specs/001-editor-default-value/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can proceed in parallel once Phase 2 is done
- **Polish (Final Phase)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational (Phase 2)
- **User Story 2 (P2)**: Depends on Foundational (Phase 2)
- **User Story 3 (P3)**: Depends on Foundational (Phase 2)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Store/validation before UI wiring
- Settings save/reset before editor application

### Parallel Opportunities

- Setup tasks with [P] can run in parallel
- Foundational tasks with [P] can run in parallel
- Tests within the same story marked [P] can run in parallel
- Different user stories can be worked on in parallel after Phase 2

---

## Parallel Example: User Story 1

```text
T005 Add unit test for saving defaults in src/test/ticketSettingsDefaultsSave.test.ts
T006 Add unit test for applying defaults on new ticket in src/test/ticketEditorDefaultsApply.test.ts
```

## Parallel Example: User Story 2

```text
T010 Add unit test for updating defaults in src/test/ticketSettingsDefaultsUpdate.test.ts
T011 Add unit test for reset-to-blank behavior in src/test/ticketSettingsDefaultsReset.test.ts
```

## Parallel Example: User Story 3

```text
T015 Add unit test for displaying current defaults in src/test/ticketSettingsDefaultsDisplay.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → Validate
3. User Story 2 → Validate
4. User Story 3 → Validate
5. Polish phase

### Parallel Team Strategy

- After Foundational, separate owners can implement US1/US2/US3 in parallel
- Tests for each story can be authored in parallel before implementation
