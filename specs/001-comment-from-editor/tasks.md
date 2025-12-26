---

description: "Task list template for feature implementation"
---

# Tasks: Comment from Editor

**Input**: Design documents from `/specs/001-comment-from-editor/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `src/test/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Replace legacy comment commands with editor-based commands in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Implement editor content validation helper in `src/utils/commentValidation.ts`
- [ ] T003 Implement editor-based add/edit helpers in `src/commands/commentPrompt.ts`
- [ ] T004 Implement editor-content add/update API wrappers in `src/redmine/comments.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Add Comment from Editor Content (Priority: P1) 🎯 MVP

**Goal**: Post active editor content as a new comment to the selected ticket.

**Independent Test**: User selects a ticket, runs add-comment, and sees the
editor content appear as a new comment.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T005 [P] [US1] Add tests for editor content validation in `src/test/editorCommentValidation.test.ts`
- [ ] T006 [P] [US1] Add tests for add-comment payload from editor in `src/test/addCommentEditor.test.ts`
- [ ] T007 [P] [US1] Add tests for add-comment error handling in `src/test/addCommentError.test.ts`

### Implementation for User Story 1

- [ ] T008 [P] [US1] Implement add-comment from editor command in `src/commands/addComment.ts`
- [ ] T009 [US1] Wire add-comment command to use active editor in `src/extension.ts`
- [ ] T010 [US1] Refresh comments after add-comment in `src/views/commentsView.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Update Comment from Editor Content (Priority: P2)

**Goal**: Replace a user-owned comment with active editor content.

**Independent Test**: User selects a comment, runs edit-comment, and sees the
editor content replace the comment.

### Tests for User Story 2 (MANDATORY) ⚠️

- [ ] T011 [P] [US2] Add tests for edit-comment payload from editor in `src/test/editCommentEditor.test.ts`
- [ ] T012 [P] [US2] Add tests for edit-comment error handling in `src/test/editCommentError.test.ts`

### Implementation for User Story 2

- [ ] T013 [P] [US2] Implement edit-comment from editor command in `src/commands/editComment.ts`
- [ ] T014 [US2] Wire edit-comment command to use active editor in `src/extension.ts`
- [ ] T015 [US2] Refresh comments after edit-comment in `src/views/commentsView.ts`

**Checkpoint**: User Story 2 should be independently functional and testable

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T016 [P] Update quickstart with editor-based comment flow in `specs/001-comment-from-editor/quickstart.md`
- [ ] T017 [P] Update README with editor-based comment commands in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- All tests for a user story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add tests for editor content validation in src/test/editorCommentValidation.test.ts"
Task: "Add tests for add-comment payload from editor in src/test/addCommentEditor.test.ts"
Task: "Add tests for add-comment error handling in src/test/addCommentError.test.ts"

# Launch core implementation tasks for User Story 1 together:
Task: "Implement add-comment from editor command in src/commands/addComment.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
