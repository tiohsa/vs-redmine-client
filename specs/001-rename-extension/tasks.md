# Tasks: 拡張機能名をRedmine Clientへ変更

**Input**: Design documents from `/specs/001-rename-extension/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: TDDに従い、表示名の変更に関連するテストを先に作成して失敗を確認する。

**Organization**: ユーザーストーリー単位でタスクを分割し、独立して実装・検証できるようにする。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 変更箇所の把握と検証準備

- [x] T001 [P] 表示名が存在する箇所を洗い出す（参照: `package.json`, `README.md`, `README.ja.md`）
- [x] T002 [P] 既存の表示名に関するテストを確認する（参照: `src/test/`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 変更後の表示名を検証するための基盤を整える

- [x] T003 [P] 拡張機能の表示名を検証するテストスタブを追加する `src/test/extensionDisplayName.test.ts`

**Checkpoint**: Foundational完了後、ユーザーストーリーの実装に着手可能

---

## Phase 3: User Story 1 - 表示名がRedmine Clientになる (Priority: P1) 🎯 MVP

**Goal**: 主要なユーザー向け表示が「Redmine Client」で統一される

**Independent Test**: 拡張機能一覧、Activity Bar、コマンド、READMEで旧名称が残らないことを確認できる

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T004 [P] [US1] 拡張機能一覧の表示名を検証するテストを追加する `src/test/extensionDisplayName.test.ts`
- [x] T005 [P] [US1] Activity Barタイトルの表示名を検証するテストを追加する `src/test/extensionDisplayName.test.ts`
- [x] T006 [P] [US1] コマンド名の表示に旧名称が残らないことを検証するテストを追加する `src/test/extensionDisplayName.test.ts`
- [x] T007 [P] [US1] README内の名称統一を検証するテストを追加する `src/test/extensionDisplayName.test.ts`

### Implementation for User Story 1

- [x] T008 [US1] 拡張機能一覧の表示名を更新する `package.json`
- [x] T009 [US1] Activity Barの表示名を更新する `package.json`
- [x] T010 [US1] コマンド表示名に残る旧名称を置換する `package.json`
- [x] T011 [US1] README表記を「Redmine Client」に統一する `README.md`
- [x] T012 [US1] 日本語README表記を「Redmine Client」に統一する `README.ja.md`

**Checkpoint**: User Story 1 単体で検証可能

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 仕上げと全体検証

- [ ] T013 [P] `specs/001-rename-extension/quickstart.md` の検証手順を実行する

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
Task: "拡張機能一覧の表示名を検証するテストを追加する src/test/extensionDisplayName.test.ts"
Task: "Activity Barタイトルの表示名を検証するテストを追加する src/test/extensionDisplayName.test.ts"
Task: "コマンド名の表示に旧名称が残らないことを検証するテストを追加する src/test/extensionDisplayName.test.ts"
Task: "README内の名称統一を検証するテストを追加する src/test/extensionDisplayName.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. MVP検証（主要表示が「Redmine Client」）

### Incremental Delivery

1. Setup + Foundational
2. User Story 1 → 独立検証
3. Polish
