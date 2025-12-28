---

description: "Task list for fixed editor path setting"
---

# Tasks: 編集ファイルパス固定設定

**Input**: Design documents from `/specs/001-fix-editor-path/`
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

**Purpose**: 設定項目の追加を整理する

- [X] T001 編集ファイル保存先の設定項目を追加する (package.json)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 保存先解決の基盤を追加する

- [X] T002 [P] 保存先ディレクトリ設定の取得ヘルパーを追加する (src/config/settings.ts)
- [X] T003 [P] 保存先ディレクトリのパス検証ユーティリティを追加する (src/views/ticketPreview.ts)
- [X] T004 [P] パス検証ユーティリティのテストを追加する (src/test/untitledPath.test.ts または新規テストファイル)

**Checkpoint**: 設定値の取得と検証がテストで確認できる

---

## Phase 3: User Story 1 - 編集ファイルの保存先を設定できる (Priority: P1) 🎯 MVP

**Goal**: 設定パスに編集ファイルが作成される

**Independent Test**: 設定パスを指定して編集ファイルが作成される

### Tests for User Story 1 (MANDATORY)

- [X] T005 [P] [US1] 設定パス利用時に保存先が指定ディレクトリになるテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)
- [X] T006 [P] [US1] 既存ファイルがある場合に再利用されるテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)

### Implementation for User Story 1

- [X] T007 [US1] チケット選択時の編集ファイル保存先を設定値に切り替える (src/views/ticketPreview.ts)
- [X] T008 [US1] 設定パスのファイルが存在する場合は再利用する処理を追加する (src/views/ticketPreview.ts)

**Checkpoint**: US1 が独立して動作し、テストが通る

---

## Phase 4: User Story 2 - 設定未指定時は従来動作を維持する (Priority: P2)

**Goal**: 設定なしでも既存保存先が使われる

**Independent Test**: 設定が空でも従来と同じ保存先になる

### Tests for User Story 2 (MANDATORY)

- [X] T009 [P] [US2] 設定未指定時に従来の保存先を使うテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)
- [X] T010 [P] [US2] 無効なパス指定時にフォールバックするテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)

### Implementation for User Story 2

- [X] T011 [US2] 設定未指定または無効時に従来の保存先へフォールバックする (src/views/ticketPreview.ts)
- [X] T012 [US2] 無効なパス時にエラー通知する (src/utils/notifications.ts, src/views/ticketPreview.ts)

**Checkpoint**: US2 が独立して動作し、テストが通る

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと検証

- [X] T013 [P] quickstart の検証手順を確認し、必要なら追記する (specs/001-fix-editor-path/quickstart.md)

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
- T009/T010 は並列で作成可能

---

## Parallel Example: User Story 1

```bash
Task: "設定パス利用時に保存先が指定ディレクトリになるテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)"
Task: "既存ファイルがある場合に再利用されるテストを追加する (src/test/ticketPreview.test.ts または新規テストファイル)"
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
