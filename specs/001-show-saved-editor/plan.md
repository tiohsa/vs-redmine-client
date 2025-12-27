# Implementation Plan: 保存済み状態でのエディタ表示

**Branch**: `[001-show-saved-editor]` | **Date**: 2025-12-27 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-show-saved-editor/spec.md  
**Input**: Feature specification from `/specs/001-show-saved-editor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

チケット/コメント選択時の初期表示は下書き優先とし、必要時にReloadでRedmineと同期して保存済み内容へ置き換える。Reloadはチケット単位・コメントの各エディタ単位で実行でき、失敗時は表示内容を保持し失敗を明示する。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack, @vscode/test-cli, ESLint  
**Storage**: なし（下書き/表示はインメモリ）  
**Testing**: @vscode/test-cli（npm test）  
**Target Platform**: VS Code Extension (desktop)  
**Project Type**: single  
**Performance Goals**: 選択後 1 秒以内に表示  
**Constraints**: 永続化を追加しない、下書きは自動で保存済みへ上書きしない、Reloadは明示操作  
**Scale/Scope**: 既存のチケット/コメント編集フロー内の表示切替と同期のみ

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
/home/glorydays/projects/src/ts/todoex/specs/001-show-saved-editor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
/home/glorydays/projects/src/ts/todoex/src/
/home/glorydays/projects/src/ts/todoex/tests/
```

**Structure Decision**: 既存の単一プロジェクト構成（src/ と tests/）を維持する。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Phase 0: Outline & Research

- 既存のRedmine同期フローを前提に、Reloadでの同期・上書き・失敗時保持の方針を確定する。
- 仕様の明確化済み事項を research.md に整理する。

## Phase 1: Design & Contracts

- データモデル（チケット/コメント/下書き/エディタ表示）を data-model.md に整理。
- Reloadおよび保存済み取得の契約を contracts/ に定義。
- quickstart.md に検証手順（npm test / npm run lint）を記載。
- `.specify/scripts/bash/update-agent-context.sh codex` を実行。
- Constitution Check を再確認する。

## Constitution Check (Post-Design)

- TDD: 単体テスト先行の方針を維持。
- TypeScript strict mode: 維持。
- DRY: 重複ロジックの追加なし。

## Phase 2: Planning (preview)

- 受け入れシナリオに対応するテストケースと実装タスクを分解する（tasks.md で詳細化）。
