---

description: "Task list for feature implementation"

---

# Tasks: プロジェクト別テンプレート

**Input**: Design documents from `/specs/001-project-template/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED by constitution and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared helpers and constants used across stories

- [x] T001 [P] Add template constants (templates dir, default file) in `src/utils/templateConstants.ts`
- [x] T002 [P] Add template fixture helpers in `src/test/helpers/templateFixtures.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core template resolution logic shared by all stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add unit tests for case-insensitive exact matcher in `src/test/templateMatcher.test.ts`
- [x] T004 Implement template name matcher in `src/utils/templateMatcher.ts`
- [x] T005 Add unit tests for resolver outcomes (match, duplicate, default, missing default) in `src/test/templateResolver.test.ts`
- [x] T006 Implement template resolution from `redmine-client.editorStorageDirectory/templates` in `src/utils/templateResolver.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - プロジェクト別テンプレート適用 (Priority: P1) 🎯 MVP

**Goal**: 選択したプロジェクト名に一致するテンプレートを新規作成時に自動適用する

**Independent Test**: プロジェクト名に一致するテンプレートがある場合に、初期入力へ反映されること

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T007 [US1] Add unit tests for project-aware draft resolution in `src/test/ticketEditorTemplate.test.ts`

### Implementation for User Story 1

- [x] T008 [P] [US1] Thread selected project name into draft resolution in `src/commands/createTicketFromList.ts`
- [x] T009 [P] [US1] Thread selected project name into draft resolution in `src/commands/createChildTicketFromList.ts`
- [x] T010 [US1] Use template resolver with project name in `src/views/ticketPreview.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - テンプレートの設定と更新 (Priority: P2)

**Goal**: テンプレートファイルの追加・更新が次回の新規作成に反映される

**Independent Test**: テンプレートファイルを更新後、次回の作成で新しい内容が使われること

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T011 [US2] Add unit tests ensuring resolver reads file changes each time in `src/test/templateResolver.test.ts`

### Implementation for User Story 2

- [x] T012 [US2] Ensure resolver reads template content per invocation (no cache) in `src/utils/templateResolver.ts`

**Checkpoint**: User Story 2 should be independently testable

---

## Phase 5: User Story 3 - テンプレート未設定時の既定動作 (Priority: P3)

**Goal**: プロジェクト別テンプレートがない場合に既定テンプレートを適用する

**Independent Test**: 該当テンプレートがない場合でも既定テンプレートが反映されること

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T013 [US3] Add unit tests for default-template fallback in `src/test/templateResolver.test.ts`

### Implementation for User Story 3

- [x] T014 [US3] Apply default-template fallback outcome in `src/views/ticketPreview.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story validation and documentation touch-ups

- [x] T015 [P] Validate quickstart steps and document updates in `specs/001-project-template/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Independent of US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core resolver logic before command wiring
- Story complete before moving to next priority

### Parallel Opportunities

- T001 and T002 can run in parallel
- After Phase 2, US1/US2/US3 can proceed in parallel if staffed
- US1 tasks T008 and T009 can run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
Task: "Add unit tests for project-aware draft resolution in src/test/ticketEditorTemplate.test.ts"
Task: "Thread selected project name into draft resolution in src/commands/createTicketFromList.ts"
Task: "Thread selected project name into draft resolution in src/commands/createChildTicketFromList.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Add unit tests ensuring resolver reads file changes each time in src/test/templateResolver.test.ts"
Task: "Ensure resolver reads template content per invocation (no cache) in src/utils/templateResolver.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "Add unit tests for default-template fallback in src/test/templateResolver.test.ts"
Task: "Apply default-template fallback outcome in src/views/ticketPreview.ts"
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
2. Add User Story 1 → Test independently (MVP)
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently

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
- Verify tests fail before implementing
- Avoid vague tasks or cross-story dependencies that break independence
