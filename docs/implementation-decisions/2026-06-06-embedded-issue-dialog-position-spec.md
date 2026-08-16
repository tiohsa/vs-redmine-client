# Embedded Issue Dialog Position Spec 実装判断ログ

日付: 2026-06-06
ステータス: 保留
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `spec-docs/redmine_report_embedded_issue_dialog_position_change_spec_en.md`

## 前提

参照仕様は `tiohsa/redmine_report` の Task Details Dialog 内にある embedded issue dialogs を対象としている。
主な対象ファイルは `spa/src/components/projectStatusReport/taskDetails/EmbeddedIssueDialogs.tsx` と
`spa/src/components/projectStatusReport/embeddedIssueDialog.ts` とされている。

この作業ディレクトリは `tiohsa/vs-redmine-client` の VS Code 拡張機能であり、`spa/` ディレクトリ、
React `.tsx` ファイル、`SubIssueCreationDialog`、`IssueEditDialog`、`IssueViewDialog`、
`CompactDialogFrame`、`dialogHeightPx` は現在の作業ツリーに存在しない。

## 判断

### 1. 現リポジトリには仕様対象の実装を追加しない

仕様の完了条件は create/edit/view embedded issue dialogs の共有フレーム高さ、中央配置、
iframe 読み込み後の位置安定、bulk section 展開時の高さ安定を検証すること。
現在のリポジトリには該当 UI とテスト対象が存在しないため、別の Dashboard UI へ近似変更を入れても
仕様の完了条件を満たした証拠にならない。

代替案として VS Code Dashboard のチケット作成パネルへ同様の固定高さダイアログを追加することも可能だが、
これは `redmine_report` の `EmbeddedIssueDialogs.tsx` への変更ではなく、仕様外のユーザー-visible 変更になる。
そのため、対象リポジトリまたは対象ファイルが提供されるまで実装は保留する。

## 検証

- `git status --short` で既存の未コミット変更を確認した。
- `rg -n "CompactDialogFrame|dialogHeightPx|DEFAULT_DIALOG_WIDTH_PX|SubIssueCreationDialog|IssueEditDialog|IssueViewDialog|embedded|iframe" src spec-docs docs package.json`
  で仕様対象シンボルが `spec-docs/` 内にしか存在しないことを確認した。
- `find . ... -name '*.tsx'` で現在の作業ツリーに `.tsx` 実装ファイルが存在しないことを確認した。
- CodeGraph は未初期化で、`CodeGraph not initialized` が返ったため使用できなかった。

## 未解決事項

仕様を実装するには、`tiohsa/redmine_report` リポジトリ、または仕様で指定された `spa/src/...` ファイル群が必要。
