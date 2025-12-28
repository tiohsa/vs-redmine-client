# Tasks: Activity Bar アイコン更新

**Input**: Design documents from `/specs/001-activitybar-icon/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for this user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Confirm Activity Bar icon path remains unchanged in package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- No foundational tasks required for a static SVG asset update.

---

## Phase 3: User Story 1 - Activity Bar のアイコンを更新する (Priority: P1) 🎯 MVP

**Goal**: Activity Bar の TodoEx アイコンが指定された SVG デザインに更新されている

**Independent Test**: Activity Bar のアイコン SVG が指定パスと一致し、`fill="currentColor"` を維持する

### Tests for User Story 1 (MANDATORY) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T002 [P] [US1] Add/update SVG content assertion in src/test/activityBarViews.test.ts

### Implementation for User Story 1

- [X] T003 [US1] Replace SVG content in media/todoex-activitybar.svg with the provided path and `fill="currentColor"`
- [X] T004 [US1] Update any icon-related expectations in src/test/activityBarViews.test.ts to match the new SVG

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T005 [P] Validate quickstart steps in specs/001-activitybar-icon/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Not applicable for this feature
- **User Story 1 (Phase 3)**: Depends on Setup completion
- **Polish (Final Phase)**: Depends on User Story 1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Setup (Phase 1)

### Within User Story 1

- Tests MUST be written and FAIL before implementation
- SVG update after test coverage is in place
- Update expectations last

### Parallel Opportunities

- T002 and T005 can run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
# Launch the test task and quickstart validation in parallel:
Task: "Add/update SVG content assertion in src/test/activityBarViews.test.ts"
Task: "Validate quickstart steps in specs/001-activitybar-icon/quickstart.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 3: User Story 1 (tests → SVG update → expectations)
3. **STOP and VALIDATE**: Run tests and confirm Activity Bar icon matches spec

### Incremental Delivery

1. Complete Setup
2. Complete User Story 1
3. Validate quickstart steps

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
