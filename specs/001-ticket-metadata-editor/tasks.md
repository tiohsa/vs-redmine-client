---

description: "Task list template for feature implementation"
---

# Tasks: チケットメタデータ表示・更新

**Input**: Design documents from `/specs/001-ticket-metadata-editor/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: ユーザーストーリーごとに単体テスト必須。実装前に失敗を確認する。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 共有テスト素材と下準備

- [x] T001 [P] メタデータYAMLの共通テストフィクスチャを追加する `src/test/helpers/ticketMetadataFixtures.ts`
- [x] T002 [P] チケットエディタ本文生成の補助スタブを追加する `src/test/helpers/ticketEditorMetadataStubs.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全ストーリーで共有する基盤ロジック

- [x] T003 メタデータ定数と型を定義する `src/views/ticketMetadataTypes.ts`
- [x] T004 メタデータYAMLの解析・直列化・検証を実装する `src/views/ticketMetadataYaml.ts`
- [x] T005 チケット下書きにメタデータのベース/ドラフトを保持できるよう拡張する `src/views/ticketSaveTypes.ts`
- [x] T006 メタデータのベース/ドラフト操作を追加する `src/views/ticketDraftStore.ts`

**Checkpoint**: 基盤ロジックが利用可能

---

## Phase 3: User Story 1 - メタデータを確認する (Priority: P1) 🎯 MVP

**Goal**: エディタ内の `---` 区間にメタデータを表示できる

**Independent Test**: 既存チケットを開いたとき、メタデータブロックが表示される

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T007 [P] [US1] メタデータブロック挿入/保持のテストを追加する `src/test/ticketMetadataBlock.test.ts`
- [x] T008 [P] [US1] エディタ表示用本文の組み立てテストを追加する `src/test/ticketEditorContentMetadata.test.ts`

### Implementation for User Story 1

- [x] T009 [US1] `TicketEditorContent` にメタデータ領域を追加し入出力を更新する `src/views/ticketEditorContent.ts`
- [x] T010 [US1] チケットプレビュー生成にメタデータブロックを含める `src/views/ticketPreview.ts`
- [x] T011 [US1] メタデータブロックが無い場合の自動挿入を追加する `src/views/ticketEditorContent.ts`

**Checkpoint**: ユーザーストーリー1が独立して動作

---

## Phase 4: User Story 2 - メタデータを編集して更新する (Priority: P2)

**Goal**: 編集したメタデータが更新時に反映される

**Independent Test**: メタデータ編集後に更新し、更新ペイロードが反映される

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T012 [P] [US2] メタデータ差分計算のテストを追加する `src/test/ticketMetadataUpdate.test.ts`
- [x] T013 [P] [US2] 更新ペイロードにメタデータ項目が含まれるテストを追加する `src/test/ticketUpdatePayload.test.ts`

### Implementation for User Story 2

- [x] T014 [US2] エディタ本文からメタデータを解析し差分を算出する `src/views/ticketSaveSync.ts`
- [x] T015 [US2] メタデータ更新フィールドを追加する `src/redmine/types.ts`
- [x] T016 [US2] 更新ペイロードに tracker/priority/status/due_date を追加する `src/redmine/issues.ts`
- [x] T017 [US2] メタデータの変更をドラフト状態へ反映する `src/views/ticketDraftStore.ts`

**Checkpoint**: ユーザーストーリー2が独立して動作

---

## Phase 5: User Story 3 - 形式不備を検知する (Priority: P3)

**Goal**: 形式不備のメタデータを検知して更新を拒否する

**Independent Test**: 不正なメタデータで更新するとエラーになる

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T018 [P] [US3] 不正YAML/必須欠落/キー重複のテストを追加する `src/test/ticketMetadataValidation.test.ts`

### Implementation for User Story 3

- [x] T019 [US3] 仕様に沿ったバリデーション結果を返す `src/views/ticketMetadataYaml.ts`
- [x] T020 [US3] バリデーションエラー時に保存結果を失敗として返す `src/views/ticketSaveSync.ts`
- [x] T021 [US3] 保存エラーの通知メッセージを明確化する `src/views/ticketSaveNotifications.ts`

**Checkpoint**: ユーザーストーリー3が独立して動作

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 横断的な整備

- [x] T022 [P] メタデータ仕様に合わせた開発ノートを更新する `specs/001-ticket-metadata-editor/quickstart.md`
- [x] T023 テスト命名と重複ロジックを見直す `src/test/ticketMetadataBlock.test.ts`, `src/test/ticketMetadataUpdate.test.ts`, `src/test/ticketMetadataValidation.test.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion
- **User Stories (Phase 3-5)**: Depends on Foundational completion
- **Polish (Phase 6)**: Depends on user story completion

### User Story Dependencies

- **User Story 1 (P1)**: Foundational完了後に開始、他ストーリー依存なし
- **User Story 2 (P2)**: Foundational完了後に開始、US1と並行可
- **User Story 3 (P3)**: Foundational完了後に開始、US1/US2と並行可

### Within Each User Story

- テスト → 実装の順で実施
- 依存するタスクは完了後に着手

### Parallel Opportunities

- Phase 1 の [P] タスクは並行実行可能
- Phase 3-5 の [P] テストは並行実行可能

---

## Parallel Example: User Story 1

```bash
Task: "メタデータブロック挿入/保持のテストを追加する src/test/ticketMetadataBlock.test.ts"
Task: "エディタ表示用本文の組み立てテストを追加する src/test/ticketEditorContentMetadata.test.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "メタデータ差分計算のテストを追加する src/test/ticketMetadataUpdate.test.ts"
Task: "更新ペイロードにメタデータ項目が含まれるテストを追加する src/test/ticketUpdatePayload.test.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "不正YAML/必須欠落/キー重複のテストを追加する src/test/ticketMetadataValidation.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. User Story 1 の単体テストが通ることを確認

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → テスト → デモ
3. User Story 2 → テスト → デモ
4. User Story 3 → テスト → デモ

### Parallel Team Strategy

- Foundational完了後にUS1/US2/US3を並行で進行可能
