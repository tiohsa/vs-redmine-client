# Implementation Plan: エディタ初期値設定

**Branch**: `001-editor-default-value` | **Date**: 2025-12-28 | **Spec**: `/home/glorydays/projects/src/ts/todoex/specs/001-editor-default-value/spec.md`
**Input**: Feature specification from `/specs/001-editor-default-value/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

新規登録エディタの初期値を設定画面で管理し、次回の新規登録時に自動反映する。初期値は利用者ごと・全入力項目対象で、無効値は保存不可とする。実装は既存の拡張機能構成に合わせ、インメモリ状態で初期値を保持・適用する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: インメモリ（永続化なし）  
**Testing**: @vscode/test-cli（ユニットテスト必須）  
**Target Platform**: VS Code Extension  
**Project Type**: single  
**Performance Goals**: 設定保存および新規登録表示での初期値反映がユーザー操作から1秒以内  
**Constraints**: 永続化変更なし、TypeScript strict維持、重複ロジック禁止  
**Scale/Scope**: 1ユーザー/1ワークスペース、初期値対象は最大100項目程度

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-editor-default-value/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/

tests/
```

**Structure Decision**: 単一拡張機能プロジェクト構成を採用し、`src/` と `tests/` 配下に機能実装とテストを配置する。

## Phase 0: Outline & Research

- 不明点なし（Technical Context を確定済み）。
- 研究結果は `research.md` に意思決定として記録する。

## Phase 1: Design & Contracts

- `data-model.md` に初期値設定のエンティティと検証規則を整理する。
- `contracts/` に設定取得・更新・リセットのAPI契約を定義する。
- `quickstart.md` に機能検証の最短手順をまとめる。
- `.specify/scripts/bash/update-agent-context.sh codex` を実行してコンテキスト更新する。

## Phase 2: Planning

- 詳細タスクは `/speckit.tasks` で作成する。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
