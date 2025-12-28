---

description: "Task list for tree expand/collapse"
---

# Tasks: ツリー全展開/全折り畳み

**Input**: Design documents from `/specs/001-tree-expand-collapse/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: ユニットテストは必須。各ストーリーのテストを先に作成し、失敗を確認してから実装する。

**Organization**: ユーザーストーリーごとに独立実装・独立テストできるように分割する。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並列実行可能 (別ファイル、依存なし)
- **[Story]**: US1/US2/US3 のいずれか
- すべてのタスクに具体的なファイルパスを含める

## Path Conventions

- 単一プロジェクト: `src/`, `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 共有設定の追加

- [x] T001 package.json に全展開/全折り畳みコマンド定義を追加する (package.json)
- [x] T002 package.json の view/title にプロジェクト/チケット用の全展開・全折り畳みメニューを追加する (package.json)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 共有ロジックと一括操作の基盤

- [x] T003 [P] ツリー配下のノードID収集テストを追加する (src/test/treeBuilder.test.ts)
- [x] T004 ツリー配下のノードID収集ヘルパーを追加する (src/views/treeBuilder.ts)
- [x] T005 [P] 一括展開/折り畳み用の状態更新テストを追加する (src/test/treeState.test.ts)
- [x] T006 ツリー状態の一括更新ヘルパーを追加する (src/views/treeState.ts)

**Checkpoint**: 共有ロジックの準備完了

---

## Phase 3: User Story 1 - プロジェクト一覧の一括展開/折り畳み (Priority: P1) 🎯 MVP

**Goal**: プロジェクト一覧で全展開/全折り畳みが操作できる

**Independent Test**: プロジェクト一覧に複数階層がある状態で全展開/全折り畳みを実行し、表示中ノードが期待通りに展開/折り畳みされる

### Tests for User Story 1 (MANDATORY)

- [x] T007 [P] プロジェクト一覧の view/title アクション宣言テストを追加する (src/test/projectsViewTitleActions.test.ts)
- [x] T008 [P] プロジェクト一覧の全展開/全折り畳み挙動テストを追加する (src/test/treeExpandCollapse.test.ts)

### Implementation for User Story 1

- [x] T009 プロジェクト一覧で表示中ノードに対する全展開/全折り畳み処理を追加する (src/views/projectsView.ts)
- [x] T010 プロジェクト一覧の全展開/全折り畳みコマンドを登録し、ビューへ接続する (src/extension.ts)

**Checkpoint**: User Story 1 が独立して動作し、テストが通る

---

## Phase 4: User Story 2 - チケット一覧の一括展開/折り畳み (Priority: P2)

**Goal**: チケット一覧で全展開/全折り畳みが操作できる

**Independent Test**: フィルタ適用中のチケット一覧で全展開/全折り畳みを実行し、表示中ノードのみが期待通りに更新される

### Tests for User Story 2 (MANDATORY)

- [x] T011 [P] チケット一覧の view/title アクション宣言テストを更新する (src/test/ticketsViewTitleActions.test.ts)
- [x] T012 [P] チケット一覧の全展開/全折り畳み挙動テストを追加する (src/test/treeExpandCollapse.test.ts)

### Implementation for User Story 2

- [x] T013 チケット一覧でフィルタ後の表示中ノードに対する全展開/全折り畳み処理を追加する (src/views/ticketsView.ts)
- [x] T014 チケット一覧の全展開/全折り畳みコマンドを登録し、ビューへ接続する (src/extension.ts)

**Checkpoint**: User Story 2 が独立して動作し、テストが通る

---

## Phase 5: User Story 3 - 展開状態の復元 (Priority: P3)

**Goal**: 展開状態がワークスペース内で永続保持され、再起動後も復元される

**Independent Test**: 展開状態を保存したあと再初期化し、同一IDのノードが復元されることを確認できる

### Tests for User Story 3 (MANDATORY)

- [x] T015 [P] ワークスペースストレージ用のテストヘルパーを追加する (src/test/helpers/vscodeMemento.ts)
- [x] T016 [P] 展開状態の永続化・上限5,000件のテストを追加する (src/test/treeState.test.ts)

### Implementation for User Story 3

- [x] T017 展開状態の永続化/復元と上限処理を追加する (src/views/treeState.ts)
- [x] T018 拡張起動時にワークスペースストレージから展開状態を初期化する (src/extension.ts)

**Checkpoint**: User Story 3 が独立して動作し、テストが通る

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 横断的な仕上げ

- [x] T019 [P] quickstart の検証手順を確認し、必要なら追記する (specs/001-tree-expand-collapse/quickstart.md)
- [x] T020 [P] 全ストーリーのユニットテストを実行する手順を確認する (specs/001-tree-expand-collapse/quickstart.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし
- **Foundational (Phase 2)**: Setup 完了後
- **User Stories (Phase 3-5)**: Foundational 完了後
- **Polish (Phase 6)**: 必要な User Story 完了後

### User Story Dependencies

- **US1 (P1)**: Foundational 完了後に着手可
- **US2 (P2)**: Foundational 完了後に着手可
- **US3 (P3)**: US1/US2 と並行可能だが、永続復元は独立で確認する

### Within Each User Story

- テスト作成 → 失敗確認 → 実装
- 共有ヘルパー → 各ビュー実装

### Parallel Opportunities

- Phase 2 の [P] は並列実行可能
- Story 内の [P] テストは並列実行可能
- US1/US2 の実装は別担当で並列可

---

## Parallel Example: User Story 1

```bash
Task: "プロジェクト一覧の view/title アクション宣言テストを追加する (src/test/projectsViewTitleActions.test.ts)"
Task: "プロジェクト一覧の全展開/全折り畳み挙動テストを追加する (src/test/treeExpandCollapse.test.ts)"
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
3. US3 → テスト → デモ

---

## Notes

- [P] タスクは異なるファイルで依存がない場合のみ
- すべてのタスクにファイルパスを付ける
- 先にテストを作成し、失敗を確認してから実装する
