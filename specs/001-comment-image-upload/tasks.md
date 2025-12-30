---

description: "Task list for コメント画像アップロード"
---

# Tasks: コメント画像アップロード

**Input**: Design documents from `/specs/001-comment-image-upload/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for each user story and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shared test utilities

- [x] T001 Create shared markdown image test helper in `src/test/helpers/markdownImageTestUtils.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core behavior that MUST be complete before ANY user story can be implemented

- [x] T002 Enforce upload failure as save failure in `src/views/commentSaveSync.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - コメント保存で画像が利用可能 (Priority: P1) 🎯 MVP

**Goal**: 新規コメント保存時に画像リンクがアップロードされ、失敗時は保存が失敗する

**Independent Test**: 新規コメントに画像リンクを含めて保存し、アップロード成功時は表示でき、失敗時は保存が失敗する

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T003 [P] [US1] Add unit test for upload failure on new comment save in `src/test/commentSaveSyncMarkdownImages.test.ts`
- [x] T004 [P] [US1] Add unit test for addCommentForIssue image uploads in `src/test/addCommentCommand.test.ts`
- [x] T005 [P] [US1] Add unit test for promptForComment image uploads in `src/test/commentPromptCommand.test.ts`

### Implementation for User Story 1

- [x] T006 [US1] Process markdown image uploads and pass uploads in `src/commands/addComment.ts`
- [x] T007 [US1] Process markdown image uploads and pass uploads in `src/commands/commentPrompt.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - コメント編集で画像が更新される (Priority: P2)

**Goal**: コメント編集時に画像リンクを再評価し、アップロード結果が反映される

**Independent Test**: 既存コメントに画像リンクを追加・変更して保存し、画像が表示される

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T008 [P] [US2] Add unit test for image uploads on comment edit in `src/test/commentSaveSyncMarkdownImages.test.ts`
- [x] T009 [P] [US2] Add unit test for editComment image uploads in `src/test/editCommentCommand.test.ts`

### Implementation for User Story 2

- [x] T010 [US2] Process markdown image uploads and pass uploads in `src/commands/editComment.ts`

**Checkpoint**: User Story 2 is fully functional and testable independently

---

## Phase 5: User Story 3 - 既存の画像リンクが影響を受けない (Priority: P3)

**Goal**: 画像リンクを含まないコメント保存が従来通りである

**Independent Test**: 画像リンクなしのコメント保存でアップロード処理が発生しない

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T011 [P] [US3] Add unit test for no-image comment save path in `src/test/commentSaveSyncMarkdownImages.test.ts`

### Implementation for User Story 3

- [x] T012 [US3] Confirm no-image save path unchanged in `src/views/commentSaveSync.ts`

**Checkpoint**: User Story 3 is fully functional and testable independently

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation and cleanup across stories

- [ ] T013 [P] Run quickstart validation steps in `/home/glorydays/projects/src/ts/todoex/specs/001-comment-image-upload/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core behavior before command integrations
- Story complete before moving to next priority

### Parallel Opportunities

- T003, T004, T005 can run in parallel (different files)
- T008, T009 can run in parallel (different files)
- T011 can run in parallel with other story test tasks (different files)

---

## Parallel Example: User Story 1

```bash
Task: "Add unit test for upload failure on new comment save in src/test/commentSaveSyncMarkdownImages.test.ts"
Task: "Add unit test for addCommentForIssue image uploads in src/test/addCommentCommand.test.ts"
Task: "Add unit test for promptForComment image uploads in src/test/commentPromptCommand.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Stop and validate User Story 1 independently

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → Validate
3. User Story 2 → Validate
4. User Story 3 → Validate
5. Polish & cross-cutting validation
