# Tasks: 選択ハイライト青系統一

**Input**: Design documents from `/specs/001-blue-highlight/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: TDDに従い、ハイライト色変更の検証テストを先に作成して失敗を確認する。

**Organization**: ユーザーストーリー単位でタスクを分割し、独立して実装・検証できるようにする。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 変更対象の把握と検証準備

- [x] T001 [P] 選択ハイライトの定義箇所を確認する（参照: `src/views/`, `src/test/`）
- [x] T002 [P] 既存の選択ハイライトに関するテストを確認する（参照: `src/test/`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 変更後の選択ハイライト色を検証するテスト基盤を用意する

- [x] T003 [P] 選択ハイライト色の検証テストを追加する `src/test/selectionHighlight.test.ts`

**Checkpoint**: Foundational完了後、ユーザーストーリーの実装に着手可能

---

## Phase 3: User Story 1 - 選択中の項目が見分けやすい (Priority: P1) 🎯 MVP

**Goal**: プロジェクト/チケット/コメントの選択ハイライトが同一の青系カラーで統一される

**Independent Test**: 選択ハイライト色が3種別すべてで青系に統一され、旧色が残らない

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T004 [P] [US1] プロジェクトの選択ハイライトが青系であることを検証する `src/test/selectionHighlight.test.ts`
- [x] T005 [P] [US1] チケットの選択ハイライトが青系であることを検証する `src/test/selectionHighlight.test.ts`
- [x] T006 [P] [US1] コメントの選択ハイライトが青系であることを検証する `src/test/selectionHighlight.test.ts`
- [x] T007 [P] [US1] 旧ハイライト色が残っていないことを検証する `src/test/selectionHighlight.test.ts`

### Implementation for User Story 1

- [x] T008 [US1] プロジェクト/チケット/コメントの選択ハイライト色を青系で統一する `src/views/`
- [x] T009 [US1] 既存のハイライト色定義を新色へ置換する `src/views/`

**Checkpoint**: User Story 1 単体で検証可能

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体検証

- [ ] T010 [P] `specs/001-blue-highlight/quickstart.md` の検証手順を実行する

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
- ハイライト色更新はテスト通過後に実施する

---

## Parallel Example: User Story 1

```bash
Task: "プロジェクトの選択ハイライトが青系であることを検証する src/test/selectionHighlight.test.ts"
Task: "チケットの選択ハイライトが青系であることを検証する src/test/selectionHighlight.test.ts"
Task: "コメントの選択ハイライトが青系であることを検証する src/test/selectionHighlight.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. MVP検証（選択ハイライトが青系で統一）

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → 独立検証
3. Polish
