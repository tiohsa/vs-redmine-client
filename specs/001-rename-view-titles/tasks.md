# Tasks: ビュータイトル短縮

**Input**: Design documents from `/specs/001-rename-view-titles/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: TDDに従い、ビュータイトル変更の検証テストを先に作成して失敗を確認する。

**Organization**: ユーザーストーリー単位でタスクを分割し、独立して実装・検証できるようにする。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 変更対象の把握と検証準備

- [x] T001 [P] ビュー名の定義箇所を確認する（参照: `package.json`）
- [x] T002 [P] 既存のActivity Barビュー関連テストを確認する（参照: `src/test/activityBarViews.test.ts`, `src/test/activityBarLists.test.ts`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 変更後のビュータイトルを検証するテスト基盤を用意する

- [x] T003 [P] ビュータイトル変更を検証するテストを追加する `src/test/activityBarViewTitles.test.ts`

**Checkpoint**: Foundational完了後、ユーザーストーリーの実装に着手可能

---

## Phase 3: User Story 1 - ビュー名を短くする (Priority: P1) 🎯 MVP

**Goal**: サイドバーの3つのビュータイトルが指定の名称に統一される

**Independent Test**: サイドバー表示でProjects/Tickets/Commentsが表示され、旧名称が残らない

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T004 [P] [US1] Projects/Tickets/Commentsの表示名を検証するテストを作成する `src/test/activityBarViewTitles.test.ts`
- [x] T005 [P] [US1] 旧名称が残っていないことを検証するテストを作成する `src/test/activityBarViewTitles.test.ts`

### Implementation for User Story 1

- [x] T006 [US1] Activity Barビュー名をProjects/Tickets/Commentsへ更新する `package.json`
- [x] T007 [US1] 旧名称を参照するテスト期待値を更新する `src/test/activityBarViewTitles.test.ts`

**Checkpoint**: User Story 1 単体で検証可能

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体検証

- [ ] T008 [P] `specs/001-rename-view-titles/quickstart.md` の検証手順を実行する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 先に着手可能
- **Foundational (Phase 2)**: Setup完了後に実施
- **User Stories (Phase 3+)**: Foundational完了後に開始
- **Polish (Final Phase)**: 必要なユーザーストーリー完了後

### User Story Dependencies

- **User Story 1 (P1)**: Foundational完了後に開始（他ストーリー依存なし）

### Within Each User Story

- テストを先に作成して失敗を確認する
- 表示名更新はテスト通過後に実施する

---

## Parallel Example: User Story 1

```bash
Task: "Projects/Tickets/Commentsの表示名を検証するテストを作成する src/test/activityBarViewTitles.test.ts"
Task: "旧名称が残っていないことを検証するテストを作成する src/test/activityBarViewTitles.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. MVP検証（Projects/Tickets/Commentsが表示される）

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → 独立検証
3. Polish
