---

description: "Task list for ticket list subject refresh"
---

# Tasks: チケット一覧件名更新

**Input**: Design documents from `/specs/001-update-ticket-list-subject/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: ユニットテストは必須。各ストーリーのテストを先に作成し、失敗を確認してから実装する。

**Organization**: ユーザーストーリーごとに独立実装・独立テストできるように分割する。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並列実行可能 (別ファイル、依存なし)
- **[Story]**: US1/US2 のいずれか
- すべてのタスクに具体的なファイルパスを含める

## Path Conventions

- 単一プロジェクト: `src/`, `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 共有準備

- [X] T001 件名更新の反映条件をまとめた参照メモを追加する (specs/001-update-ticket-list-subject/research.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 一覧行の更新経路と識別子の紐付け基盤

- [X] T002 [P] 件名更新イベントの通知テストを追加する (src/test/ticketsView.test.ts)
- [X] T003 チケット一覧の行更新ヘルパーを追加する (src/views/ticketsView.ts)

**Checkpoint**: 行更新の基盤が準備完了

---

## Phase 3: User Story 1 - 更新後の件名が一覧に反映される (Priority: P1) 🎯 MVP

**Goal**: 保存成功時に該当行の件名だけが更新される

**Independent Test**: 件名を変更して保存後に一覧の件名が最新値になる

### Tests for User Story 1 (MANDATORY)

- [X] T004 [P] [US1] 保存成功時に件名が更新されるテストを追加する (src/test/ticketSaveSync.test.ts)

### Implementation for User Story 1

- [X] T005 [US1] 保存成功時に一覧の該当行件名を更新する処理を追加する (src/views/ticketSaveSync.ts)

**Checkpoint**: User Story 1 が独立して動作し、テストが通る

---

## Phase 4: User Story 2 - 一覧の並びや選択状態を維持 (Priority: P2)

**Goal**: 件名更新後も並び順と選択状態が維持される

**Independent Test**: 更新反映後に並びと選択が変わらない

### Tests for User Story 2 (MANDATORY)

- [X] T006 [P] [US2] 件名更新後も選択状態が維持されるテストを追加する (src/test/ticketsView.test.ts)

### Implementation for User Story 2

- [X] T007 [US2] 件名更新時に並び順と選択状態を維持する処理を追加する (src/views/ticketsView.ts)

**Checkpoint**: User Story 2 が独立して動作し、テストが通る

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体確認

- [X] T008 [P] quickstart の検証手順を確認し、必要なら追記する (specs/001-update-ticket-list-subject/quickstart.md)
- [X] T009 [P] 反映条件の注意事項を追記する (specs/001-update-ticket-list-subject/research.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし
- **Foundational (Phase 2)**: Setup 完了後
- **User Stories (Phase 3-4)**: Foundational 完了後
- **Polish (Phase 5)**: 必要な User Story 完了後

### User Story Dependencies

- **US1 (P1)**: Foundational 完了後に着手可
- **US2 (P2)**: US1 完了後に検証

### Within Each User Story

- テスト作成 → 失敗確認 → 実装
- 一覧更新は最小更新のまま維持

### Parallel Opportunities

- T002/T004/T006 は並列で作成可能

---

## Parallel Example: User Story 1

```bash
Task: "保存成功時に件名が更新されるテストを追加する (src/test/ticketSaveSync.test.ts)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 → Phase 2 完了
2. Phase 3 (US1) を実装
3. US1 のテストを独立実行して確認

### Incremental Delivery

1. US1 → テスト → デモ
2. US2 → テスト → デモ

---

## Notes

- [P] タスクは異なるファイルで依存がない場合のみ
- すべてのタスクにファイルパスを付ける
- 先にテストを作成し、失敗を確認してから実装する
