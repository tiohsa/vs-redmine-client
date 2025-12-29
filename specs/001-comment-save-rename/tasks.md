# Tasks: Comment Save Rename

**Input**: Design documents from `/specs/001-comment-save-rename/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md
**Tests**: 仕様でユニットテスト必須のため、各ユーザーストーリーでテストを先に作成する。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 既存コードの確認と計画の前提整理

- [X] T001 既存のコメント保存フローを確認して変更点をメモする /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T002 既存のファイル名生成ロジックを確認して更新要件を整理する /home/glorydays/projects/src/ts/todoex/src/views/editorFilename.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全ストーリーで共有される基盤の更新

- [X] T003 更新用ファイル名の種別ラベル定数を追加する /home/glorydays/projects/src/ts/todoex/src/views/commentSaveTypes.ts
- [X] T004 コメント識別子取得失敗の通知文言を追加する /home/glorydays/projects/src/ts/todoex/src/views/commentSaveNotifications.ts
- [X] T005 更新用ファイル名の構成（projectId/ticketId/commentId/label）を反映する /home/glorydays/projects/src/ts/todoex/src/views/editorFilename.ts

**Checkpoint**: Foundational updates complete

---

## Phase 3: User Story 1 - 新規コメント保存後に継続編集できる (Priority: P1) 🎯 MVP

**Goal**: 新規コメント保存後にファイル名を更新用へ切り替え、次回保存が同一コメント更新になる

**Independent Test**: 新規コメント保存→ファイル名切替→再保存で同一コメント更新が確認できる

### Tests for User Story 1 (MANDATORY) ⚠️

- [X] T006 [P] [US1] 新規コメント保存後に更新モードへ切り替わることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveRename.test.ts
- [X] T007 [P] [US1] 更新後の再保存で同一コメント更新になることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveSync.test.ts

### Implementation for User Story 1

- [X] T008 [US1] 新規コメント保存成功時に更新モードへ切り替える処理を追加 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T009 [US1] 更新モードへの遷移状態を記録する処理を追加 /home/glorydays/projects/src/ts/todoex/src/views/commentEditStore.ts
- [X] T010 [US1] 更新モード判定の呼び出しを追加 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts

**Checkpoint**: User Story 1 完了（単独で動作確認）

---

## Phase 4: User Story 2 - 失敗時は追加モードのまま再試行できる (Priority: P2)

**Goal**: 保存失敗や識別子取得失敗時に追加モードを維持し再試行できる

**Independent Test**: 保存失敗/識別子取得失敗時にファイル名が変わらず追加モード維持を確認できる

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T011 [P] [US2] 保存失敗時に追加モード維持となることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveNotifications.test.ts
- [X] T012 [P] [US2] コメント識別子取得失敗時に通知と追加モード維持となることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveRenameFailure.test.ts
- [X] T013 [P] [US2] 保存直後にエディタが閉じられても切り替えが完了することをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentEditorBinding.test.ts

### Implementation for User Story 2

- [X] T014 [US2] 保存失敗時はファイル名を変更しない分岐を明確化 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T015 [US2] コメント識別子取得失敗時に追加モード維持と通知を実装 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T016 [US2] 保存直後にエディタが閉じられていても切り替え処理を完了するように補強 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T017 [US2] コメント更新時にも一覧を更新する判定ロジックを追加 /home/glorydays/projects/src/ts/todoex/src/views/commentSaveSync.ts
- [X] T018 [P] [US2] コメント更新時の一覧更新判定をテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveRefresh.test.ts

**Checkpoint**: User Story 2 完了（単独で動作確認）

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: ドキュメント・整理・確認

- [ ] T019 [P] クイックスタートのシナリオが通ることを確認 /home/glorydays/projects/src/ts/todoex/specs/001-comment-save-rename/quickstart.md
- [ ] T020 仕様との整合チェックとコメント更新用ファイル名の説明補足 /home/glorydays/projects/src/ts/todoex/specs/001-comment-save-rename/spec.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし
- **Foundational (Phase 2)**: Setup 完了が必要
- **User Story 1 (Phase 3)**: Foundational 完了が必要
- **User Story 2 (Phase 4)**: Foundational 完了が必要
- **Polish (Phase 5)**: US1/US2 完了が必要

### User Story Dependencies

- **US1 (P1)**: Foundational 完了後に開始
- **US2 (P2)**: Foundational 完了後に開始（US1に依存しないが同時実行可）

### Parallel Opportunities

- US1 のテスト (T006, T007) は並列実行可
- US2 のテスト (T011, T012, T013) は並列実行可
- Foundational の T003 と T004 は並列実行可

---

## Parallel Example: User Story 1

```bash
# US1 テストを並列で作成
Task: "新規コメント保存後にファイル名が更新用へ切り替わることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveRename.test.ts"
Task: "更新後の再保存で同一コメント更新になることをテスト追加 /home/glorydays/projects/src/ts/todoex/src/test/commentSaveSync.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup)
2. Phase 2 (Foundational)
3. Phase 3 (US1)
4. US1 単独テストで完了判定

### Incremental Delivery

1. Setup + Foundational
2. US1 → 単独テスト
3. US2 → 単独テスト
4. Polish
