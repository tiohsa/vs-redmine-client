---

description: "Task list template for feature implementation"
---

# Tasks: Redmine Ticket Workflow

**Input**: Design documents from `/specs/001-redmine-ticket-workflow/`
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

- [x] T001 Create shared folders for Redmine integration in `src/redmine/`, `src/views/`, `src/commands/`, `src/utils/`, `src/config/`
- [x] T002 Define Redmine extension settings (base URL, API key, project selection defaults) in `package.json`
- [x] T003 [P] Add settings access wrapper in `src/config/settings.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement Redmine HTTP client with API key auth in `src/redmine/client.ts`
- [x] T005 Implement common Redmine types (Project, Ticket, Comment, Attachment, Filter) in `src/redmine/types.ts`
- [x] T006 Implement error notification helper in `src/utils/notifications.ts`
- [x] T007 Implement Mermaid conversion helper in `src/utils/mermaid.ts`
- [x] T008 Implement attachment upload helper (file + clipboard) in `src/redmine/attachments.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Browse and Preview Tickets (Priority: P1) 🎯 MVP

**Goal**: Browse project tickets with filters and preview details read-only.

**Independent Test**: User can list tickets (including child projects), filter by status/assignee, and open a read-only preview.

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US1] Add tests for ticket list loading and pagination in `src/test/ticketsList.test.ts`
- [x] T010 [P] [US1] Add tests for filter behavior (status/assignee full options) in `src/test/ticketFilters.test.ts`
- [x] T011 [P] [US1] Add tests for read-only preview rendering in `src/test/ticketPreview.test.ts`

### Implementation for User Story 1

- [x] T012 [P] [US1] Implement projects API wrapper in `src/redmine/projects.ts`
- [x] T013 [P] [US1] Implement issues API wrapper (list/detail) in `src/redmine/issues.ts`
- [x] T014 [US1] Implement ticket list tree provider with filters and child project toggle in `src/views/ticketsView.ts`
- [x] T015 [US1] Implement read-only ticket preview rendering in `src/views/ticketPreview.ts`
- [x] T016 [US1] Wire view commands (refresh, select project, toggle child projects) in `src/extension.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Create Tickets from Editor Content (Priority: P2)

**Goal**: Create new tickets from editor content with attachments and Mermaid conversion.

**Independent Test**: User can submit editor content as a ticket, attach images, and see Mermaid converted in the posted description.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T017 [P] [US2] Add tests for Mermaid conversion on submit in `src/test/mermaidConversion.test.ts`
- [x] T018 [P] [US2] Add tests for ticket creation payload using editor content in `src/test/ticketCreate.test.ts`
- [x] T019 [P] [US2] Add tests for file and clipboard attachments in `src/test/attachments.test.ts`

### Implementation for User Story 2

- [x] T020 [P] [US2] Implement issue creation API wrapper in `src/redmine/issues.ts`
- [x] T021 [P] [US2] Implement command to create ticket from active editor in `src/commands/createTicket.ts`
- [x] T022 [US2] Integrate Mermaid conversion and attachment upload in `src/commands/createTicket.ts`
- [x] T023 [US2] Wire ticket creation command and UI entry point in `src/extension.ts`

**Checkpoint**: User Story 2 should be independently functional and testable

---

## Phase 5: User Story 3 - Edit Existing Comments (Priority: P3)

**Goal**: Edit the user's own existing comments from within the editor.

**Independent Test**: User can select their own comment, edit it, and see the update reflected in ticket history.

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T024 [P] [US3] Add tests for comment list selection and edit flow in `src/test/commentEdit.test.ts`
- [x] T025 [P] [US3] Add tests to ensure only user-owned comments are editable in `src/test/commentPermissions.test.ts`

### Implementation for User Story 3

- [x] T026 [P] [US3] Implement comments API wrapper (list/update) in `src/redmine/comments.ts`
- [x] T027 [US3] Implement comment list view and selection in `src/views/commentsView.ts`
- [x] T028 [US3] Implement comment edit command in `src/commands/editComment.ts`
- [x] T029 [US3] Wire comment edit commands and view contributions in `src/extension.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T030 [P] Update README with Redmine workflow usage and configuration in `README.md`
- [x] T031 [P] Add failure messaging examples to quickstart in `specs/001-redmine-ticket-workflow/quickstart.md`
- [x] T032 Run quickstart validation in `specs/001-redmine-ticket-workflow/quickstart.md`

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Independent of US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all required tests for User Story 1 together:
Task: "Add tests for ticket list loading and pagination in src/test/ticketsList.test.ts"
Task: "Add tests for filter behavior (status/assignee full options) in src/test/ticketFilters.test.ts"
Task: "Add tests for read-only preview rendering in src/test/ticketPreview.test.ts"

# Launch all models/services for User Story 1 together:
Task: "Implement projects API wrapper in src/redmine/projects.ts"
Task: "Implement issues API wrapper (list/detail) in src/redmine/issues.ts"
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
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

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
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
