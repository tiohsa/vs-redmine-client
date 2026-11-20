# 開発と検証

拡張の起動点は [src/extension.ts](../src/extension.ts) です。Extension Host で接続先と永続ストアを初期化し、同期・エディタイベント・コマンド・ビューを登録します。Dashboard は Webview と Extension Host のプロトコルで通信します。

新規機能の配置と公開 API は [AGENTS.md](../AGENTS.md) の Feature Verification に従います。[参照機能](../src/layers/extension-host/features/reference-example/index.ts) と [アーキテクチャー設定](../architecture.config.json) で実際に適用される境界を確認できます。

| 確認対象 | コマンド |
| --- | --- |
| TypeScript の型 | `pnpm exec tsc --noEmit` |
| ESLint とアーキテクチャーゲート | `pnpm run lint` |
| webpack ビルド | `pnpm run compile` |
| Extension Host のテスト | `pnpm test` |
| Docker で Redmine を起動する E2E | `pnpm run test:e2e` |
| Dashboard のブラウザー検証 | `pnpm run test:dashboard-ui` |
| 静的ゲートと Extension Host の参照シナリオ | `pnpm run verify:all` |

実 Redmine を使う E2E はローカルで実行します。GitHub Actions の CI と Release は通常の Extension Host テスト設定を使い、Docker E2E と実 Redmine 向けの復旧テストを実行対象から外しています。

ヘッドレス Linux では `xvfb-run -a pnpm run verify:all` を使用できます。コマンドやビューを追加した場合は [機能マップ](../verification/feature-map.json) の入口を更新します。主要操作が変わる場合は、操作に対応するセレクター、確認条件、テストも更新します。

実際の Redmine で同期を確認する場合は、[ライブ検証スクリプト](../scripts/run-live-redmine-tests.cjs) と [テストシナリオ](../src/test/live/) を参照してください。ライブ検証用に用意した環境で `pnpm run test:live-redmine` を実行します。通常の Extension Host テストの対象から `src/test/live/` を除外しています。専用コマンドではエディター操作のシナリオも実行します。既定の出力先は `docs/reports/` です。

Docker Compose が利用できる環境では `pnpm run test:e2e` が Redmine を起動し、起動完了を待ってから共通データを登録します。各スイートが専用のプロジェクトとテストデータを登録し、終了時に削除します。Dashboard の操作だけを確認するには `REDMINE_LIVE_ONLY=dashboardWorkflow pnpm run test:e2e` を実行します。検証用コンテナとボリュームの削除には `pnpm run test:e2e:down` を使用します。

画像付きコメントの同期復旧を個別に確認する場合は、先に `pnpm run test:e2e` で検証用の `e2e-seed` プロジェクトを作成します。テストをコンパイルし、検証用 Redmine の `REDMINE_SYNC_LIVE_URL` と `REDMINE_API_KEY` を環境変数に設定して `pnpm exec vscode-test --config .vscode-test-live-recovery.mjs` を実行します。
