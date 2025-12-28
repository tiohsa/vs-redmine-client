# Tasks: 一覧行のブラウザ表示アイコン追加

**Input**: Design documents from `/specs/001-open-in-browser/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Confirm Activity Bar list item implementations in src/views (projects, tickets, comments)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T002 Add URL builder helpers for project, ticket, and comment links in src/utils/redmineUrls.ts
- [X] T003 Add command registration scaffolding for open-in-browser actions in src/extension.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 一覧からブラウザで開く (Priority: P1) 🎯 MVP

**Goal**: Activity Bar の各行からブラウザで該当ページを開ける

**Independent Test**: 各行のアイコンから正しいURLが生成され、既定ブラウザで開く

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] [US1] Add URL builder tests for project/ticket/comment anchors in src/test/redmineUrls.test.ts
- [X] T005 [P] [US1] Add command error handling tests for missing identifiers in src/test/openInBrowserCommands.test.ts

### Implementation for User Story 1

- [X] T006 [US1] Implement open-in-browser commands for project/ticket/comment in src/commands/openInBrowser.ts
- [X] T007 [US1] Wire Activity Bar list item icons to commands in package.json view/item/context entries
- [X] T008 [US1] Wire Activity Bar list item icons to commands in package.json view/item/context entries
- [X] T009 [US1] Wire Activity Bar list item icons to commands in package.json view/item/context entries
- [X] T010 [US1] Add Activity Bar view item context menu or inline icon contributions in package.json
- [X] T011 [US1] Ensure browser launch errors surface via notifications in src/utils/notifications.ts

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T012 [P] Update quickstart steps in specs/001-open-in-browser/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion
- **Polish (Final Phase)**: Depends on User Story 1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)

### Within User Story 1

- Tests MUST be written and FAIL before implementation
- URL builders before commands
- Commands before view wiring

### Parallel Opportunities

- T004 and T005 can run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
# Launch tests in parallel:
Task: "Add URL builder tests for project/ticket/comment anchors in src/test/redmineUrls.test.ts"
Task: "Add command error handling tests for missing identifiers in src/test/openInBrowserCommands.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Confirm browser opens correct URLs from each Activity Bar list

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deliver MVP
3. Validate quickstart steps

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing
