---

description: "Task list for Ticket Editor Pinning"
---

# Tasks: Ticket Editor Pinning

**Input**: Design documents from `/specs/001-ticket-editor-pinning/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for ticket editor tracking

- [X] T001 Create shared ticket editor types in `src/views/ticketEditorTypes.ts`
- [X] T002 [P] Add editor test stubs for VS Code APIs in `src/test/helpers/editorStubs.ts`
- [X] T003 [P] Create ticket editor registry module scaffold in `src/views/ticketEditorRegistry.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Write registry unit tests for add/remove/focus resolution in `src/test/ticketEditorRegistry.test.ts`
- [X] T005 Implement registry core operations in `src/views/ticketEditorRegistry.ts`
- [X] T006 [P] Wire active editor tracking to registry in `src/extension.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - チケットごとの専用エディタに再利用 (Priority: P1) 🎯 MVP

**Goal**: Ticket re-selection reuses the dedicated editor and focuses the last active editor when multiple exist.

**Independent Test**: Select tickets A/B and reselect A; ensure the same editor is focused and no new editor is created.

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T007 [P] [US1] Add unit tests for ticket reselect focus behavior in `src/test/ticketSelectionFocus.test.ts`
- [X] T008 [P] [US1] Add unit tests for dedicated editor recreation when closed in `src/test/ticketEditorClosure.test.ts`

### Implementation for User Story 1

- [X] T009 [US1] Update ticket preview opening to reuse registry-backed editors in `src/views/ticketPreview.ts`
- [X] T010 [US1] Update ticket selection command to route through new preview logic in `src/extension.ts`
- [X] T011 [US1] Ensure last-active editor tracking is updated on focus in `src/views/ticketEditorRegistry.ts`
- [X] T012 [US1] Align ticket tree command arguments for new selection flow in `src/views/ticketsView.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - コメントは同じチケットエディタで扱う (Priority: P2)

**Goal**: Comment drafts are preserved per ticket and comment actions operate within the ticket editor.

**Independent Test**: Start a comment draft on ticket A, switch to ticket B, then return to A and confirm the draft persists in the same editor.

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T013 [P] [US2] Add unit tests for per-ticket draft persistence in `src/test/commentDraftStore.test.ts`
- [X] T014 [P] [US2] Add unit tests for comment commands binding to ticket editor drafts in `src/test/commentEditorBinding.test.ts`

### Implementation for User Story 2

- [X] T015 [US2] Create comment draft store in `src/views/commentDraftStore.ts`
- [X] T016 [US2] Persist and restore drafts on ticket focus in `src/views/ticketPreview.ts`
- [X] T017 [US2] Read draft content from ticket editor when adding comments in `src/commands/addComment.ts`
- [X] T018 [US2] Read draft content from ticket editor when editing comments in `src/commands/editComment.ts`
- [X] T019 [US2] Sync input-box comment prompts with draft store in `src/commands/commentPrompt.ts`

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 任意に新規エディタを追加して編集 (Priority: P3)

**Goal**: Users can explicitly open extra editors for the same ticket without disrupting existing editors.

**Independent Test**: With a ticket open, invoke “new editor” and confirm a second editor opens for the same ticket while the original remains.

### Tests for User Story 3 (MANDATORY) ⚠️

- [X] T020 [P] [US3] Add unit tests for extra editor creation behavior in `src/test/extraTicketEditor.test.ts`

### Implementation for User Story 3

- [X] T021 [US3] Add command handler to open extra editors in `src/extension.ts`
- [X] T022 [US3] Implement extra editor creation in `src/views/ticketPreview.ts`
- [X] T023 [US3] Register command contribution for extra editor action in `package.json`
- [X] T024 [US3] Expose extra editor action in ticket context menu in `package.json`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T025 [P] Add regression test for multi-editor focus resolution in `src/test/ticketEditorRegression.test.ts`
- [X] T026 [P] Validate quickstart steps in `specs/001-ticket-editor-pinning/quickstart.md`

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with ticket editor reuse
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Shared types before services/utilities
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1 tasks marked [P] can run in parallel
- Phase 2 task T006 can run in parallel after T004 starts
- Within each story, tests marked [P] can run in parallel
- User stories can be worked on in parallel after Phase 2

---

## Parallel Example: User Story 1

```text
Task: "Add unit tests for ticket reselect focus behavior in src/test/ticketSelectionFocus.test.ts"
Task: "Add unit tests for dedicated editor recreation when closed in src/test/ticketEditorClosure.test.ts"
```

---

## Parallel Example: User Story 2

```text
Task: "Add unit tests for per-ticket draft persistence in src/test/commentDraftStore.test.ts"
Task: "Add unit tests for comment commands binding to ticket editor drafts in src/test/commentEditorBinding.test.ts"
```

---

## Parallel Example: User Story 3

```text
Task: "Add unit tests for extra editor creation behavior in src/test/extraTicketEditor.test.ts"
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

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Avoid cross-story dependencies that break independence
