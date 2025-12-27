---

description: "Task list template for feature implementation"
---

# Tasks: 更新時のchildren子チケット追加

**Input**: Design documents from `/specs/001-add-children-on-update/`
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

- [x] T001 [P] Add update-specific children fixtures in src/test/helpers/ticketMetadataFixtures.ts
- [x] T002 [P] Add update editor metadata stubs with children in src/test/helpers/ticketEditorMetadataStubs.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared metadata support needed by all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Update IssueMetadata to include optional children list in src/views/ticketMetadataTypes.ts
- [x] T004 Update metadata equality to compare children in src/views/ticketMetadataTypes.ts
- [x] T005 Add children default handling in src/views/ticketEditorDefaultsStore.ts
- [x] T006 Extend ticket editor content model to carry children in src/views/ticketEditorContent.ts
- [x] T007 Allow children YAML list parsing/serialization in src/views/ticketMetadataYaml.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 更新時の子チケット追加 (Priority: P1) 🎯 MVP

**Goal**: 更新時に children を指定して子チケットを追加でき、更新後は children が空になる

**Independent Test**: 更新時に children を指定すると子チケットが追加され、既存の子は変更されず children が空になる

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T008 [P] [US1] Add update-with-children test in src/test/ticketSaveSync.test.ts
- [x] T009 [P] [US1] Add same-update duplicate children test in src/test/ticketSaveSync.test.ts

### Implementation for User Story 1

- [x] T010 [US1] Extend TicketSaveDependencies to include create/delete for children in src/views/ticketSaveSync.ts
- [x] T011 [US1] Append children on update and de-dup within same update in src/views/ticketSaveSync.ts
- [x] T012 [US1] Clear children after successful update in src/views/ticketSaveSync.ts
- [x] T013 [US1] Surface duplicate-skip reason in src/views/ticketSaveNotifications.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - children 未指定の更新 (Priority: P2)

**Goal**: children 未指定時は従来どおり子チケット追加なしで更新できる

**Independent Test**: children なしの更新で子チケットが追加されない

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T014 [P] [US2] Add update-without-children test in src/test/ticketSaveSync.test.ts

### Implementation for User Story 2

- [x] T015 [US2] Ensure update flow skips children when metadata missing in src/views/ticketSaveSync.ts

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 不正なchildren指定の防止 (Priority: P3)

**Goal**: 不正/空行/上限超過/一部失敗の children は更新全体を失敗にする

**Independent Test**: 無効な children を含む更新が失敗し理由が提示される

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T016 [P] [US3] Add invalid children update test in src/test/ticketSaveSync.test.ts
- [x] T017 [P] [US3] Add child creation failure rollback test in src/test/ticketSaveSync.test.ts

### Implementation for User Story 3

- [x] T018 [US3] Reject invalid/over-limit children in src/views/ticketMetadataYaml.ts
- [x] T019 [US3] Roll back created children and fail update on child creation errors in src/views/ticketSaveSync.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story quality improvements

- [x] T020 [P] Update update-flow metadata example in specs/001-add-children-on-update/quickstart.md

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
- Parsing/validation before update flow changes
- Story complete before moving to next priority

### Parallel Opportunities

- Setup tasks marked [P] can run in parallel
- Test tasks within a user story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
Task: "Add update-with-children test in src/test/ticketSaveSync.test.ts"
Task: "Add same-update duplicate children test in src/test/ticketSaveSync.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add update-without-children test in src/test/ticketSaveSync.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add invalid children update test in src/test/ticketSaveSync.test.ts"
Task: "Add child creation failure rollback test in src/test/ticketSaveSync.test.ts"
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

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
