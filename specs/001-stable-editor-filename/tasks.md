---

description: "Task list template for feature implementation"
---

# Tasks: Stable Editor Filenames with Comment Numbers

**Input**: Design documents from `/specs/001-stable-editor-filename/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared helpers for filenames and list rendering

- [X] T001 Create filename helper utilities in `src/views/editorFilename.ts`
- [X] T002 Add comment list formatting helper in `src/views/commentListFormat.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data wiring needed by multiple stories

- [X] T003 Extend editor registry to track project/ticket/comment IDs in `src/views/ticketEditorRegistry.ts`
- [X] T004 Provide project/ticket identifiers when opening editors in `src/views/ticketPreview.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Stable filenames on save (Priority: P1) 🎯 MVP

**Goal**: Ticket and comment editor saves use stable, unique filenames based on identifiers.

**Independent Test**: Save the same ticket or comment multiple times and confirm the filename remains unchanged and unique.

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T005 [P] [US1] Unit test filename builder for tickets in `src/test/editorFilename.test.ts`
- [X] T006 [P] [US1] Unit test filename builder for comments in `src/test/editorFilename.test.ts`

### Implementation for User Story 1

- [X] T007 [US1] Implement ticket filename builder in `src/views/editorFilename.ts`
- [X] T008 [US1] Implement comment filename builder in `src/views/editorFilename.ts`
- [X] T009 [US1] Apply stable filenames on ticket save in `src/extension.ts`
- [X] T010 [US1] Apply stable filenames on comment save in `src/extension.ts`

**Checkpoint**: User Story 1 is functional and independently testable

---

## Phase 4: User Story 2 - Comment list shows comment numbers (Priority: P2)

**Goal**: Comment list items display their comment numbers.

**Independent Test**: Load the comment list and verify each item includes its comment number.

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T011 [P] [US2] Unit test comment list label formatting in `src/test/commentListFormat.test.ts`

### Implementation for User Story 2

- [X] T012 [US2] Implement comment list label formatting in `src/views/commentListFormat.ts`
- [X] T013 [US2] Render comment numbers in list items in `src/views/commentsView.ts`

**Checkpoint**: User Stories 1 and 2 are independently functional

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [ ] T014 [P] Validate quickstart commands in `specs/001-stable-editor-filename/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational phase completion
- **Polish (Phase 5)**: Depends on completion of desired user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - independent of US1

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Helpers before wiring
- Wiring before UI rendering
- Story complete before moving to next priority

### Parallel Opportunities

- T005 and T006 can run in parallel
- T011 can run in parallel with other US2 tasks

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Unit test filename builder for tickets in src/test/editorFilename.test.ts"
Task: "Unit test filename builder for comments in src/test/editorFilename.test.ts"
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
