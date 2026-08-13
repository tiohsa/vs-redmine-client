# Markdownヘッダからのチケット作成 実装判断ログ

日付: 2026-05-31
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `docs/change-spec-create-redmine-ticket-from-markdown-header.md`
実装対象: 通常 Markdown ファイルから明示コマンドで Redmine チケットを作成する処理、frontmatter 更新、コマンド登録、ローカライズ、テスト

## 依頼と参照元の要約

通常の Markdown ファイルに Redmine 専用 frontmatter と H1 件名を記述し、明示コマンド実行と確認後に既存の `createTicketFromContent()` を使ってチケットを作成する。成功時だけ `issue_id`、`mode: ticket-update`、`last_synced_at` を Markdown ヘッダへ書き込み、二重作成と汎用 frontmatter の破壊的更新を防止する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 通常 Markdown 用のヘッダ更新処理を既存ドラフト書き換えから分離する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: `markdownTicketHeaderUpdater.ts` を追加し、Redmine 専用 frontmatter の更新と汎用キー拒否を担当させる。
- 参照元に書かれていなかったこと: 既存の `rewriteNewTicketEditorToTicketMode()` を直接流用するか、新しい updater を使うか。
- 判断: 通常 Markdown のヘッダ更新は新しい updater で行い、既存ドラフト書き換え処理は変更しない。
- 理由: 既存ドラフト経路の挙動を変えず、MVP 固有の厳格な frontmatter 検証を通常 Markdown コマンドに閉じ込めるため。
- 代替案: `rewriteNewTicketEditorToTicketMode()` に条件分岐を追加する。
- 影響: 既存 save-sync と新規ドラフト経路への回帰リスクを抑える。
- 可逆性: 高。共通化が必要になれば後から抽出できる。
- 制約: 任意判断
- ユーザー確認: 不要

### D-002 `activationEvents` に Dashboard と新コマンドを明示する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: `onCommand:redmine-client.createTicketFromMarkdownHeader` を追加する。
- 参照元に書かれていなかったこと: 現在の `package.json` には `activationEvents` 自体がないが、既存テストは Dashboard view activation を要求している。
- 判断: `activationEvents` を新設し、既存 Dashboard view と新コマンドの 2 件を明示する。
- 理由: 仕様の activation event を満たしつつ、既存 Activity Bar の activation 要件も維持するため。
- 代替案: VS Code の contributed command 自動 activation のみに依存する。
- 影響: 拡張機能の activation 条件が明示される。
- 可逆性: 高。
- 制約: 任意判断
- ユーザー確認: 不要

### D-003 upload 後本文を Markdown 更新へ反映する

- 種別: 技術制約
- タイミング: 実装中
- 参照元に書かれていたこと: 既存の Markdown 画像アップロード挙動を再利用する。
- 参照元に書かれていなかったこと: ヘッダ更新時に元本文と `createTicketFromContent()` が返す upload 後本文のどちらを使うか。
- 判断: 作成 API が返す parse 済み本文を再構築時に使い、upload 後の画像リンクをローカル Markdown に反映する。
- 理由: 元本文だけから再構築すると、Redmine へ送信した本文とローカル Markdown の画像リンクが不整合になるため。
- 代替案: 元本文の body を維持する。
- 影響: 既存ドラフト同期と同様、画像リンクが upload 後の形式へ更新される。
- 可逆性: 中。
- 制約: 制約により必須
- ユーザー確認: 不要

### D-004 API 成功後のローカル更新失敗は作成済み ID を保持して警告する

- 種別: 技術制約
- タイミング: 実装後
- 参照元に書かれていたこと: Markdown ヘッダ更新失敗時は rollback せず、作成済み issue ID を警告する。
- 参照元に書かれていなかったこと: エディタ反映・保存だけでなく、in-memory のヘッダ生成が失敗した場合の扱い。
- 判断: サービス結果に `header-update-failed` を設け、API 成功後のヘッダ生成失敗でも issue ID をコマンド層へ返す。エディタ反映例外と `document.save() === false` も同じ警告に集約する。
- 理由: API 作成は外部副作用であり、ローカル更新処理の失敗箇所に関係なく手動復旧用 ID を失わないため。
- 代替案: 想定外例外として通常エラー通知にする。
- 影響: 二重作成防止の手動復旧案内が一貫する。
- 可逆性: 高。
- 制約: 制約により必須
- ユーザー確認: 不要

## 変更・逸脱

現時点ではなし。

## 妥協点と残課題

CodeGraph は未初期化のため利用できなかった。`codegraph init -i` は未実行。

## 検証と制約

- 実行した検証: `pnpm exec tsc --noEmit`、`pnpm run compile-tests`、`pnpm run compile`、`pnpm run lint`、`git diff --check`、JSON parse、updater 単体テスト 11 件。
- 実行できなかった検証: `pnpm test` と `pnpm run test:unsafe` は Electron sandbox fatal (`sandbox_host_linux.cc:41`) で VS Code ホスト起動前に停止した。sandbox 外での `pnpm run test:unsafe` 再実行も環境側の利用制限で承認されなかった。サービス・コマンド統合テストはコンパイル済みだが VS Code ホスト上では未実行。

## 結果

通常 Markdown からの明示コマンド作成、strict frontmatter 検証、確認、既存作成処理再利用、成功後ヘッダ更新、document 登録、ローカライズ、テスト追加を実装した。VS Code 統合テストのみ環境制約で未実行。
