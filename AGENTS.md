# redmine-client AGENTS ガイド

最終更新日: 2026-04-25

## 1. 基本方針
- プロジェクト名: `redmine-client`（VS Code拡張）
- 目的: Redmineチケット運用をVS Code内で完結させる開発を安全かつ一貫して進める。
- 回答・ドキュメント・レビューコメントは日本語で記述する。
- ガイドは網羅列挙より、運用判断に必要な最新情報を短く正確に保つ。

## 2. 技術ベースライン
- 言語: TypeScript 5.9
- 主要依存: VS Code Extension API, webpack 5, `@vscode/test-cli`, ESLint
- ターゲット: VS Code 1.107+
- 実装前提: 既存のstrict TypeScript構成・拡張機能実行モデルを維持する。

## 3. リポジトリ構成
- `src/`: 拡張機能本体コード
- `src/test/`: テストコード（`@vscode/test-cli` + Mocha）
- `specs/`: 機能仕様・計画・タスク
- `spec-docs/`: 統合仕様書などの補足ドキュメント
- `scripts/`: 補助スクリプト
- `dist/`: ビルド成果物
- `out/`: テストコンパイル出力

## 4. 開発コマンド（pnpm基準）
- `pnpm test`
- `pnpm run lint`
- `pnpm run compile`
- `pnpm run test:unsafe`

## 5. コーディング規約
- TypeScript `strict`を必須とし、型安全性を下げる変更を行わない。
- 既存のESLint設定（`eslint.config.mjs`）に準拠する。
- 要件に直接関係しない大規模リファクタは行わない。
- 自分が作業していない既存変更を勝手に巻き戻さない。

## 6. テスト方針
- 変更箇所に対応する`src/test`のテストを追加または更新する。
- 最低限、`pnpm test`または影響範囲の対象テストを実行して結果を確認する。
- テスト未実行の場合は、理由と想定影響を作業報告に明記する。

## 7. スキル利用ルール
- 利用可能スキル:
  - `playwright`: ブラウザ操作・UIフロー検証が必要な場合に使用
  - `skill-creator`: スキルの新規作成・更新時に使用
  - `skill-installer`: スキル一覧取得・インストール時に使用
- 発火条件:
  - ユーザーがスキル名を明示した場合
  - 依頼内容がスキル説明に明確に一致する場合
- 適用順:
  - 複数候補がある場合は最小セットを選び、必要なら順序を明示する。
  - `SKILL.md`を先に確認し、必要最小限の関連リソースのみ読む。
- フォールバック:
  - スキルファイル欠落や手順不整合がある場合は理由を短く示し、通常手順で継続する。

## 8. 更新ルール
- 以下のいずれかが発生したPRでは、同PR内で`AGENTS.md`を更新する。
  - `package.json`のscriptsや主要開発フローの変更
  - 主要ディレクトリ構成の変更
  - 主要機能specの追加（`specs/`配下）


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
