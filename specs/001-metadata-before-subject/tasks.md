---

description: "Task list for metadata first"
---

# Tasks: メタデータ先頭配置

**Input**: Design documents from `/specs/001-metadata-before-subject/`
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

**Purpose**: 共有準備

- [x] T001 既存のエディタ本文生成/解析の責務を把握するための参照メモを追加する (specs/001-metadata-before-subject/research.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 旧形式と新形式の判定・構成ルールの基盤

- [x] T002 [P] 旧形式/新形式の並びを判定するテストを追加する (src/test/ticketEditorContent.test.ts)
- [x] T003 エディタ本文の構成要素抽出ロジックを整理する (src/views/ticketEditorContent.ts)

**Checkpoint**: 形式判定の基盤が準備完了

---

## Phase 3: User Story 1 - 先頭にメタデータを配置できる (Priority: P1) 🎯 MVP

**Goal**: 新規生成時にメタデータ→件名→本文の順で表示される

**Independent Test**: 新規本文生成でメタデータが先頭に配置され件名が直後に続く

### Tests for User Story 1 (MANDATORY)

- [x] T004 [P] [US1] 新規本文生成の順序テストを追加する (src/test/ticketEditorContent.test.ts)

### Implementation for User Story 1

- [x] T005 [US1] 新規本文生成時のメタデータ先頭配置を実装する (src/views/ticketEditorContent.ts)

**Checkpoint**: User Story 1 が独立して動作し、テストが通る

---

## Phase 4: User Story 2 - 既存形式の読み取り互換 (Priority: P2)

**Goal**: 旧形式でも正しくメタデータと件名を抽出できる

**Independent Test**: 旧形式本文を読み込んでもメタデータ/件名が正しく解析される

### Tests for User Story 2 (MANDATORY)

- [x] T006 [P] [US2] 旧形式解析の互換テストを追加する (src/test/ticketEditorContent.test.ts)

### Implementation for User Story 2

- [x] T007 [US2] 旧形式の解析ロジックを維持しつつ新形式に対応する (src/views/ticketEditorContent.ts)

**Checkpoint**: User Story 2 が独立して動作し、テストが通る

---

## Phase 5: User Story 3 - 保存時の整形規則維持 (Priority: P3)

**Goal**: 保存時に読み込んだ形式を保持し、本文の空行を維持する

**Independent Test**: 保存→再読込で形式が維持され、本文の空行が保持される

### Tests for User Story 3 (MANDATORY)

- [x] T008 [P] [US3] 形式保持と空行維持の保存テストを追加する (src/test/ticketEditorContent.test.ts)

### Implementation for User Story 3

- [x] T009 [US3] 保存時に読み込んだ形式を維持する処理を実装する (src/views/ticketEditorContent.ts)

**Checkpoint**: User Story 3 が独立して動作し、テストが通る

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体確認

- [x] T010 [P] quickstart の検証手順を確認し、必要なら追記する (specs/001-metadata-before-subject/quickstart.md)
- [x] T011 [P] テスト観点を補足し、リグレッション注意点を追記する (specs/001-metadata-before-subject/research.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし
- **Foundational (Phase 2)**: Setup 完了後
- **User Stories (Phase 3-5)**: Foundational 完了後
- **Polish (Phase 6)**: 必要な User Story 完了後

### User Story Dependencies

- **US1 (P1)**: Foundational 完了後に着手可
- **US2 (P2)**: US1 の生成規則が前提
- **US3 (P3)**: US1/US2 完了後に保存挙動を確認

### Within Each User Story

- テスト作成 → 失敗確認 → 実装
- 解析/生成ロジックは同一ファイルで逐次更新

### Parallel Opportunities

- T002/T004/T006/T008 は並列で作成可能

---

## Parallel Example: User Story 1

```bash
Task: "新規本文生成の順序テストを追加する (src/test/ticketEditorContent.test.ts)"
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
