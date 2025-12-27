# Implementation Plan: チケット・コメント一覧のアイコンボタン化

**Branch**: `001-iconize-view-buttons` | **Date**: 2025-12-27 | **Spec**: `specs/001-iconize-view-buttons/spec.md`
**Input**: Feature specification from `/specs/001-iconize-view-buttons/spec.md`

## Summary

チケット一覧とコメント一覧の「追加」「再読込」ボタンをアイコン化し、ツールチップで機能説明を補う。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: N/A（永続化変更なし、インメモリのみ）  
**Testing**: @vscode/test-cli（npm test）  
**Target Platform**: VS Code Extension（デスクトップ）  
**Project Type**: single（VS Code Extension）  
**Performance Goals**: 明示なし（VS Code UIの標準的な応答性に準拠）  
**Constraints**: 既存機能は変更せず、対象は「追加」「再読込」ボタンのみ  
**Scale/Scope**: チケット一覧・コメント一覧の2ビューに限定

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

**Gate Status**: Pass

## Project Structure

### Documentation (this feature)

```text
specs/001-iconize-view-buttons/
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
├── commands/
├── config/
├── redmine/
├── utils/
├── views/
└── extension.ts

src/test/
└── helpers/
```

**Structure Decision**: 単一のVS Code Extension構成。`src/` 配下の既存ビュー/コマンドを更新する。

## Phase 0: Outline & Research

- 既知の技術スタックと要件が明確なため追加調査は不要。
- リサーチ結果は `research.md` に決定事項として記録。

## Phase 1: Design & Contracts

- データモデル追加なし（ビュー表示のみの変更）。
- 外部API・契約変更なし（`contracts/` は変更なしの記録）。
- テストは既存のビュー系テストパターンに合わせる。

## Phase 1: Agent Context Update

- `.specify/scripts/bash/update-agent-context.sh codex` を実行し、必要であればコンテキストを更新。

## Phase 1: Constitution Check (Post-Design)

- TDD、TypeScript strict、DRYの遵守方針に変更なし。

## Phase 2: Task Planning

- タスク分解は `/speckit.tasks` で実施。
