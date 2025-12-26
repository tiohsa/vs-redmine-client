---

description: "Task list template for feature implementation"
---

# Tasks: Add Ticket Comment

**Input**: Design documents from `/specs/002-add-ticket-comment/`
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

- [x] T001 Add add-comment command contribution in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Implement comment submission API wrapper in `src/redmine/comments.ts`
- [x] T003 Implement comment input validation helper in `src/utils/commentValidation.ts`
- [x] T004 Implement comment prompt workflow helper in `src/commands/commentPrompt.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Add Comment to Selected Ticket (Priority: P1) 🎯 MVP

**Goal**: Add a comment to the selected ticket using a command-driven prompt.

**Independent Test**: User selects a ticket, runs the command, submits a
non-empty comment, and sees it in the refreshed comment list.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T005 [P] [US1] Add tests for comment validation rules in `src/test/commentValidation.test.ts`
- [x] T006 [P] [US1] Add tests for comment submission payload in `src/test/commentSubmit.test.ts`
- [x] T007 [P] [US1] Add tests for prompt behavior (clear vs preserve) in `src/test/commentPrompt.test.ts`

### Implementation for User Story 1

- [x] T008 [P] [US1] Implement add-comment command in `src/commands/addComment.ts`
- [x] T009 [US1] Wire add-comment command and selection state in `src/extension.ts`
- [x] T010 [US1] Refresh comment list after successful submission in `src/views/commentsView.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T011 [P] Update quickstart with add-comment usage in `specs/002-add-ticket-comment/quickstart.md`
- [x] T012 [P] Update README with add-comment command details in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories

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
Task: "Add tests for comment validation rules in src/test/commentValidation.test.ts"
Task: "Add tests for comment submission payload in src/test/commentSubmit.test.ts"
Task: "Add tests for prompt behavior (clear vs preserve) in src/test/commentPrompt.test.ts"

# Launch core implementation tasks for User Story 1 together:
Task: "Implement add-comment command in src/commands/addComment.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
