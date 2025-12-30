# Implementation Plan: コメント画像アップロード

**Branch**: `001-comment-image-upload` | **Date**: 2025-12-26 | **Spec**: /home/glorydays/projects/src/ts/todoex/specs/001-comment-image-upload/spec.md
**Input**: Feature specification from `/specs/001-comment-image-upload/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

コメント保存・編集時に画像リンクを検出してアップロードし、チケット編集時と同等の基準・権限・削除ルールで扱う。既存のMarkdown画像アップロード処理とRedmineのアップロードトークン連携を再利用し、アップロード失敗時はコメント保存を失敗として扱う。

## Technical Context

**Language/Version**: TypeScript 5.9  
**Primary Dependencies**: VS Code Extension API, webpack 5, @vscode/test-cli, ESLint  
**Storage**: RedmineサーバーのアップロードAPI（/uploads.json）と既存のコメント更新APIを利用  
**Testing**: @vscode/test-cli（Mocha）  
**Target Platform**: VS Code 1.107+  
**Project Type**: single（VS Code拡張）  
**Performance Goals**: 画像リンクを含むコメント保存の完了が 10 秒以内  
**Constraints**: 画像アップロードが1つでも失敗した場合はコメント保存を失敗扱い、既存のチケット編集の判定基準を踏襲  
**Scale/Scope**: コメントの追加・編集に限定（チケット本文は対象外）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TDD: unit tests written first and confirmed Red before implementation.
- TypeScript strict mode remains enabled; type checks pass.
- DRY: no duplicated business logic without justification.

Gate status: PASS（違反なし）
Post-design check: PASS（違反なし）

## Project Structure

### Documentation (this feature)

```text
specs/001-comment-image-upload/
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
├── extension.ts
├── redmine/
├── utils/
├── views/
└── test/
```

**Structure Decision**: 単一のVS Code拡張構成（src配下に実装とテストが同居）

## Complexity Tracking

No violations.
