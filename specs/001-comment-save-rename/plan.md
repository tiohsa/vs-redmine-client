# Implementation Plan: Comment Save Rename

**Branch**: `001-comment-save-rename` | **Date**: 2025-12-29 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-comment-save-rename/spec.md
**Input**: Feature specification from `/specs/001-comment-save-rename/spec.md`

## Summary

新規コメント保存後にエディタのファイル名を更新用へ1回だけ切り替え、以降は同一コメントの更新として扱う。識別子取得失敗や保存直後に閉じられた場合の挙動も含め、更新モード移行の安全性と一貫性を担保する。

## Technical Context

**Language/Version**: TypeScript 5.9
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint
**Storage**: N/A (in-memory state; editor file naming only)
**Testing**: @vscode/test-cli + Mocha (existing VS Code extension test setup)
**Target Platform**: VS Code desktop (1.107+)
**Project Type**: single (VS Code extension)
**Performance Goals**: 保存成功後2秒以内にファイル名が更新用へ切り替わる
**Constraints**: 既存のコメント編集/追加フローを壊さず、同一コメント更新として扱う
**Scale/Scope**: 単一ワークスペース、同時に複数エディタが開くケースを想定

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-comment-save-rename/
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
└── test/
```

**Structure Decision**: VS Code extensionの単一プロジェクト構成を採用し、既存の`src/`配下へ変更を追加する。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Phase 0: Research

- 実装前の不明点はなし。既存の構成と仕様で判断可能。

## Phase 1: Design & Contracts

- データモデル、契約、クイックスタートを作成済み（下記ファイル参照）。

## Constitution Check (Post-Design)

- TDD: 変更点はユニットテスト追加が前提で問題なし。
- TypeScript strict mode: 既存設定維持で問題なし。
- DRY: 既存のコメント保存/更新ロジックの再利用で対応可能。
