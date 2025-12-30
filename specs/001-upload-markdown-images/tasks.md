# Tasks: Markdown画像リンクの自動アップロード

**Input**: Design documents from `/specs/001-upload-markdown-images/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests are required by the constitution and must be written before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shared fixtures

- [x] T001 Create markdown image fixtures for tests in `src/test/helpers/markdownImageFixtures.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utilities required by all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Implement Markdown画像リンクの抽出と置換ユーティリティ in `src/utils/markdownImageLinks.ts`
- [x] T003 [P] Implement 画像拡張子/サイズ/存在チェックの検証ユーティリティ in `src/utils/markdownImageValidation.ts`
- [x] T004 [P] Implement 画像アップロードのオーケストレーション (重複排除/結果集計) in `src/utils/markdownImageUpload.ts`
- [x] T005 [P] Add WebP content type support in `src/redmine/attachments.ts`
- [x] T006 [P] Add unit tests for Markdownリンク解析/置換 in `src/test/markdownImageLinks.test.ts`
- [x] T007 [P] Add unit tests for アップロードオーケストレーション (重複/制限/失敗) in `src/test/markdownImageUpload.test.ts`
- [x] T008 Add upload result fields to save result types in `src/views/ticketSaveTypes.ts` and `src/views/commentSaveTypes.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 新規作成時の画像自動アップロード (Priority: P1) 🎯 MVP

**Goal**: チケット作成/編集でMarkdown画像リンクを自動アップロードし、本文リンクを置換する

**Independent Test**: チケット本文にローカル画像リンクを含めて保存し、添付が作成されリンクが更新される

### Tests for User Story 1 (MANDATORY)

- [x] T009 [P] [US1] Add ticket save markdown upload tests in `src/test/ticketSaveSyncMarkdownImages.test.ts`
- [x] T010 [P] [US1] Add attachment permission gate tests in `src/test/ticketSaveSyncPermissions.test.ts`

### Implementation for User Story 1

- [x] T011 [US1] Integrate markdown upload pipeline into ticket save flow in `src/views/ticketSaveSync.ts`
- [x] T012 [US1] Add uploads support for issue create/update payloads in `src/redmine/issues.ts`
- [x] T013 [US1] Enforce attachment permission gate and skip uploads with notice in `src/views/ticketSaveSync.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 既存内容の編集時アップロード (Priority: P2)

**Goal**: コメント追加/編集時にもMarkdown画像リンクの自動アップロードを適用する

**Independent Test**: コメント本文にローカル画像リンクを追加して保存し、添付とリンク更新が行われる

### Tests for User Story 2 (MANDATORY)

- [x] T014 [P] [US2] Add comment save markdown upload tests in `src/test/commentSaveSyncMarkdownImages.test.ts`

### Implementation for User Story 2

- [x] T015 [US2] Integrate markdown upload pipeline into comment save flow in `src/views/commentSaveSync.ts`
- [x] T016 [US2] Add uploads support for comment add/update payloads in `src/redmine/comments.ts`
- [x] T017 [US2] Apply replaced markdown back to comment draft state in `src/views/commentSaveSync.ts`

**Checkpoint**: User Stories 1 and 2 should work independently

---

## Phase 5: User Story 3 - アップロード失敗時の復旧 (Priority: P3)

**Goal**: アップロード失敗を通知し、保存は成功扱いとして継続できる

**Independent Test**: 失敗する画像を含む保存で失敗一覧が表示され、本文保存が完了する

### Tests for User Story 3 (MANDATORY)

- [x] T018 [P] [US3] Add ticket upload failure notification tests in `src/test/ticketSaveNotifications.test.ts`
- [x] T019 [P] [US3] Add comment upload failure notification tests in `src/test/commentSaveNotifications.test.ts`

### Implementation for User Story 3

- [x] T020 [US3] Extend ticket save results and notifications for upload failures in `src/views/ticketSaveTypes.ts` and `src/views/ticketSaveNotifications.ts`
- [x] T021 [US3] Extend comment save results and notifications for upload failures in `src/views/commentSaveTypes.ts` and `src/views/commentSaveNotifications.ts`
- [x] T022 [US3] Propagate upload failure details from save flows in `src/views/ticketSaveSync.ts` and `src/views/commentSaveSync.ts`

**Checkpoint**: All user stories should be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story cleanup and documentation

- [x] T023 [P] Update quickstart for permission/failure notes in `specs/001-upload-markdown-images/quickstart.md`
- [x] T024 [P] Add WebP attachment coverage in `src/test/attachments.test.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - may reuse US1 utilities
- **User Story 3 (P3)**: Can start after Foundational - depends on save result structures

### Parallel Opportunities

- Foundational utilities and their tests (T002-T007) can run in parallel
- User Story tests (T009-T010, T014, T018-T019) can run in parallel
- Ticket vs comment integrations can proceed in parallel once shared utilities land

---

## Parallel Example: User Story 1

```bash
Task: "Add ticket save markdown upload tests in src/test/ticketSaveSyncMarkdownImages.test.ts"
Task: "Add attachment permission gate tests in src/test/ticketSaveSyncPermissions.test.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Add comment save markdown upload tests in src/test/commentSaveSyncMarkdownImages.test.ts"
Task: "Integrate markdown upload pipeline into comment save flow in src/views/commentSaveSync.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "Add ticket upload failure notification tests in src/test/ticketSaveNotifications.test.ts"
Task: "Add comment upload failure notification tests in src/test/commentSaveNotifications.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Test independently → Demo
5. Finish Polish tasks
