---

description: "Task list for child ticket add icon"
---

# Tasks: チケット一覧の子チケット追加アイコン

**Input**: Design documents from `/specs/001-add-child-ticket-icon/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

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

**Purpose**: 共通の設定変更を先に整理する

- [X] T001 子チケット追加コマンドとインラインメニューの雛形を定義する (package.json)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: parent メタデータの基盤を整備する

- [X] T002 [P] parent メタデータを型定義とYAML変換に追加する (src/views/ticketMetadataTypes.ts, src/views/ticketMetadataYaml.ts)
- [X] T003 [P] parent メタデータの解析・シリアライズテストを追加する (src/test/ticketMetadataValidation.test.ts)
- [X] T004 [P] parent メタデータに対応したテストスタブを更新する (src/test/helpers/ticketMetadataFixtures.ts, src/test/helpers/ticketEditorMetadataStubs.ts)

**Checkpoint**: parent メタデータがテストで検証可能

---

## Phase 3: User Story 1 - 子チケット追加アイコンから作成を開始する (Priority: P1) 🎯 MVP

**Goal**: アイコンから親IDが設定された新規編集画面を開ける

**Independent Test**: アイコン操作で parent が設定された編集画面が開く

### Tests for User Story 1 (MANDATORY)

- [X] T005 [P] [US1] 子チケット追加コマンドの登録とインライン表示のテストを追加する (src/test/ticketsViewTitleActions.test.ts または新規テストファイル)
- [X] T006 [P] [US1] 子チケット作成時に parent と projectId が設定されるテストを追加する (src/test/ticketCreate.test.ts または新規テストファイル)

### Implementation for User Story 1

- [X] T007 [US1] 子チケット追加用コマンドを実装する (src/commands/createChildTicketFromList.ts)
- [X] T008 [US1] 既存の新規チケット下書き生成に parent を注入するヘルパーを追加する (src/views/ticketDraftStore.ts)
- [X] T009 [US1] コマンド登録とインラインメニューの実装を反映する (src/extension.ts, package.json)

**Checkpoint**: US1 が独立して動作し、テストが通る

---

## Phase 4: User Story 2 - 作成権限に応じてアイコンの挙動が整合する (Priority: P2)

**Goal**: 作成不可の場合はアイコンが表示されない

**Independent Test**: 作成不可状態でインラインアイコンが非表示になる

### Tests for User Story 2 (MANDATORY)

- [X] T010 [P] [US2] 作成権限がない場合にアイコンが表示されないテストを追加する (src/test/ticketsViewTitleActions.test.ts または新規テストファイル)

### Implementation for User Story 2

- [X] T011 [US2] 作成権限を利用した表示制御を適用する (package.json)

**Checkpoint**: US2 が独立して動作し、テストが通る

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと検証

- [X] T012 [P] quickstart の検証手順を確認し、必要なら追記する (specs/001-add-child-ticket-icon/quickstart.md)

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
- まず US1 を完成させてから US2 を確認

### Parallel Opportunities

- T002/T003/T004 は並列で作成可能
- T005/T006 は並列で作成可能

---

## Parallel Example: User Story 1

```bash
Task: "子チケット追加コマンドの登録とインライン表示のテストを追加する (src/test/ticketsViewTitleActions.test.ts または新規テストファイル)"
Task: "子チケット作成時に parent と projectId が設定されるテストを追加する (src/test/ticketCreate.test.ts または新規テストファイル)"
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
