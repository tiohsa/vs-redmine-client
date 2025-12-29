# Tasks: Activity Barメタデータ既定値削除

**Input**: Design documents from `/specs/001-remove-activitybar-default/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: TDDに従い、各ユーザーストーリーのテストを先に作成して失敗を確認する。

**Organization**: ユーザーストーリー単位でタスクを分割し、独立して実装・検証できるようにする。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 変更範囲の把握と検証準備

- [x] T001 [P] 検証コマンドが `specs/001-remove-activitybar-default/quickstart.md` と一致していることを確認する（参照: `package.json`）
- [x] T002 [P] Activity Bar設定ビューの構成と既定値UIの入口を確認する（参照: `src/views/ticketSettingsView.ts`, `src/views/ticketsView.ts`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全ストーリー共通のテスト補助を用意する

- [x] T003 [P] TicketSettingsTreeProviderのテスト用スタブを追加する `src/test/helpers/ticketSettingsViewStubs.ts`

**Checkpoint**: Foundational完了後、各ユーザーストーリーの実装に着手可能

---

## Phase 3: User Story 1 - Activity Barから既定値設定をなくす (Priority: P1) 🎯 MVP

**Goal**: Activity Bar内の全ビューでメタデータ既定値UIが表示されないようにする

**Independent Test**: Activity Barの設定ビューを開いても既定値項目が表示されないことを確認できる

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T004 [P] [US1] 既定値UIがActivity Bar設定ビューに出ないことを確認するテストを追加する `src/test/ticketSettingsDefaultsDisplay.test.ts`

### Implementation for User Story 1

- [x] T005 [US1] Activity Barの設定ビューから既定値アイテムを除外する `src/views/ticketSettingsView.ts`
- [x] T006 [US1] 既定値UI関連の未使用関数/エクスポートを整理する `src/views/ticketSettingsView.ts`

**Checkpoint**: User Story 1 単体で検証可能

---

## Phase 4: User Story 2 - ファイルの既定値が優先される (Priority: P2)

**Goal**: 既定値はファイル定義のみから適用されることを保証する

**Independent Test**: 既定値定義あり/なしの両ケースで初期値が期待通りであることを確認できる

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T007 [P] [US2] 既定値がファイル定義に従うことを確認するテストを追加する `src/test/ticketEditorDefaultsApply.test.ts`

### Implementation for User Story 2

- [x] T008 [US2] ファイル由来の既定値のみを採用する処理を確認し、必要なら調整する `src/views/ticketEditorDefaultsStore.ts`

**Checkpoint**: User Story 2 単体で検証可能

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体検証

- [ ] T009 [P] `specs/001-remove-activitybar-default/quickstart.md` の検証手順を実行する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 先に着手可能
- **Foundational (Phase 2)**: Setup完了後に実施
- **User Stories (Phase 3+)**: Foundational完了後に開始
- **Polish (Final Phase)**: 必要なユーザーストーリー完了後

### User Story Dependencies

- **User Story 1 (P1)**: Foundational完了後に開始（他ストーリー依存なし）
- **User Story 2 (P2)**: Foundational完了後に開始（他ストーリー依存なし）

### Within Each User Story

- テストを先に作成して失敗を確認する
- UI/ロジック変更はテスト通過後に実施する

---

## Parallel Example: User Story 1

このストーリー内は同一ファイル変更が中心のため並列実行は推奨しない。

---

## Parallel Example: User Story 2

このストーリー内は同一ファイル変更が中心のため並列実行は推奨しない。

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. MVP検証（Activity Barで既定値UIが消えていること）

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → 独立検証
3. User Story 2 → 独立検証
4. Polish
