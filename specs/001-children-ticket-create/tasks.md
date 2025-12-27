---

description: "Task list template for feature implementation"
---

# Tasks: childrenメタデータによる子チケット自動登録

**Input**: Design documents from `/specs/001-children-ticket-create/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths shown below reflect the current repository layout under `src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shared test scaffolding

- [x] T001 [P] Add children metadata fixtures in src/test/helpers/ticketMetadataFixtures.ts
- [x] T002 [P] Add children editor metadata stubs in src/test/helpers/ticketEditorMetadataStubs.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared metadata support needed by all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Update IssueMetadata to include optional children list in src/views/ticketMetadataTypes.ts
- [x] T004 Update metadata equality to compare children in src/views/ticketMetadataTypes.ts
- [x] T005 Add children default handling in src/views/ticketEditorDefaultsStore.ts
- [x] T006 Extend ticket editor content model to carry children in src/views/ticketEditorContent.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 子チケット一括作成 (Priority: P1) 🎯 MVP

**Goal**: children に件名一覧を指定して、親チケットと同時に子チケットを作成できる

**Independent Test**: children を指定したチケット作成が成功し、親子が紐付いて作成される

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [P] [US1] Add unit tests for valid children YAML parsing in src/test/ticketMetadataValidation.test.ts
- [x] T008 [P] [US1] Add ticket creation tests with children in src/test/ticketCreate.test.ts

### Implementation for User Story 1

- [x] T009 [US1] Allow children YAML list parsing/serialization in src/views/ticketMetadataYaml.ts
- [x] T010 [US1] Add parent_id support to create payload in src/redmine/issues.ts
- [x] T011 [US1] Create children tickets after parent creation in src/views/ticketSaveSync.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 子チケット指定なしの通常作成 (Priority: P2)

**Goal**: children を指定しない場合、従来どおり親のみ作成できる

**Independent Test**: children 未指定での作成が成功し、子チケットが作成されない

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T012 [P] [US2] Add regression test for create without children in src/test/ticketCreate.test.ts

### Implementation for User Story 2

- [x] T013 [US2] Ensure create flow skips children when metadata absent in src/views/ticketSaveSync.ts

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 不正なchildren指定の防止 (Priority: P3)

**Goal**: children が不正/空行/上限超過/一部失敗の場合は親子ともに作成しない

**Independent Test**: 不正な children 指定で作成が失敗し、理由が通知される

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T014 [P] [US3] Add validation tests for invalid children format in src/test/ticketMetadataValidation.test.ts
- [x] T015 [P] [US3] Add tests for children count limit in src/test/ticketMetadataValidation.test.ts
- [x] T016 [P] [US3] Add failure-path tests for child creation errors in src/test/ticketCreate.test.ts

### Implementation for User Story 3

- [x] T017 [US3] Reject invalid children entries (empty/blank) in src/views/ticketMetadataYaml.ts
- [x] T018 [US3] Enforce children count limit (max 50) in src/views/ticketMetadataYaml.ts
- [x] T019 [US3] Fail parent creation if any child creation fails in src/views/ticketSaveSync.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story quality improvements

- [x] T020 [P] Update feature docs with children format examples in specs/001-children-ticket-create/quickstart.md
- [x] T021 Run consistency pass for metadata error messages in src/views/ticketMetadataYaml.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational (Phase 2) - no dependencies on other stories
- **User Story 2 (P2)**: Starts after Foundational (Phase 2) - independent of US1
- **User Story 3 (P3)**: Starts after Foundational (Phase 2) - independent of US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Parsing/validation before create flow changes
- Story complete before moving to next priority

### Parallel Opportunities

- Setup tasks marked [P] can run in parallel
- Test tasks within a user story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add unit tests for valid children YAML parsing in src/test/ticketMetadataValidation.test.ts"
Task: "Add ticket creation tests with children in src/test/ticketCreate.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add regression test for create without children in src/test/ticketCreate.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add validation tests for invalid children format in src/test/ticketMetadataValidation.test.ts"
Task: "Add tests for children count limit in src/test/ticketMetadataValidation.test.ts"
Task: "Add failure-path tests for child creation errors in src/test/ticketCreate.test.ts"
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
2. Add User Story 1 → Test independently → MVP ready
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
