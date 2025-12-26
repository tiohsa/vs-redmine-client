---

description: "Task list template for feature implementation"
---

# Tasks: Editor Save Sync to Redmine

**Input**: Design documents from `/specs/001-editor-save-sync/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and state needed by multiple stories

- [X] T001 Create sync types (status, conflict reasons) in `src/views/ticketSaveTypes.ts`
- [X] T002 Create ticket draft state store in `src/views/ticketDraftStore.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core helpers used by all save flows

- [X] T003 Create ticket editor parse/serialize helpers in `src/views/ticketEditorContent.ts`
- [X] T004 Add Redmine ticket update payload builder in `src/redmine/issues.ts`
- [X] T005 Extend Redmine update types in `src/redmine/types.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Save editor changes to Redmine (Priority: P1) 🎯 MVP

**Goal**: Saving a ticket editor sends only changed fields to Redmine, detects conflicts, and preserves local edits on failure.

**Independent Test**: Save a modified ticket editor, verify the update payload and sync result logic, and confirm no update occurs when there are no changes.

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T006 [P] [US1] Unit test ticket parse/serialize in `src/test/ticketEditorContent.test.ts`
- [X] T007 [P] [US1] Unit test draft state transitions in `src/test/ticketDraftStore.test.ts`
- [X] T008 [P] [US1] Unit test update payload builder in `src/test/ticketUpdatePayload.test.ts`
- [X] T009 [P] [US1] Unit test save sync outcomes (success/none/conflict/unreachable) in `src/test/ticketSaveSync.test.ts`

### Implementation for User Story 1

- [X] T010 [US1] Implement parse/serialize logic in `src/views/ticketEditorContent.ts`
- [X] T011 [US1] Implement draft tracking and change detection in `src/views/ticketDraftStore.ts`
- [X] T012 [US1] Implement Redmine update call and payload in `src/redmine/issues.ts`
- [X] T013 [US1] Initialize draft state on editor open in `src/views/ticketPreview.ts`
- [X] T014 [US1] Implement save sync pipeline in `src/views/ticketSaveSync.ts`
- [X] T015 [US1] Wire save listener to sync pipeline in `src/extension.ts`

**Checkpoint**: User Story 1 is functional and independently testable

---

## Phase 4: User Story 2 - Clear feedback on sync result (Priority: P2)

**Goal**: Users receive clear success/failure feedback for save-to-Redmine actions.

**Independent Test**: Trigger a successful save and a failure and verify distinct user-visible notifications.

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T016 [P] [US2] Unit test notification mapping for sync results in `src/test/ticketSaveNotifications.test.ts`

### Implementation for User Story 2

- [X] T017 [US2] Implement notification mapping in `src/views/ticketSaveNotifications.ts`
- [X] T018 [US2] Display notifications from save listener in `src/extension.ts`
- [X] T019 [US2] Add any helper notification variants in `src/utils/notifications.ts`

**Checkpoint**: User Stories 1 and 2 are independently functional

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cross-story checks

- [X] T020 [P] Validate quickstart commands in `specs/001-editor-save-sync/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational phase completion
- **Polish (Phase 5)**: Depends on completion of desired user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 save pipeline being available

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Helpers before pipelines
- Pipelines before wiring
- Story complete before moving to next priority

### Parallel Opportunities

- T006, T007, T008, T009 can run in parallel
- T016 can run in parallel with other US2 tasks

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Unit test ticket parse/serialize in src/test/ticketEditorContent.test.ts"
Task: "Unit test draft state transitions in src/test/ticketDraftStore.test.ts"
Task: "Unit test update payload builder in src/test/ticketUpdatePayload.test.ts"
Task: "Unit test save sync outcomes in src/test/ticketSaveSync.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo
3. Add User Story 2 → Test independently → Demo
4. Finish Polish phase
