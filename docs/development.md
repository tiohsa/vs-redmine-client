# 開発と検証

拡張の起動点は [src/extension.ts](../src/extension.ts) です。Extension Host で接続先と永続ストアを初期化し、同期・エディタイベント・コマンド・ビューを登録します。Dashboard は Webview と Extension Host のプロトコルで通信します。

新規機能の配置と公開 API は [AGENTS.md](../AGENTS.md) の Feature Verification に従います。[参照機能](../src/layers/extension-host/features/reference-example/index.ts) と [アーキテクチャー設定](../architecture.config.json) で実際に適用される境界を確認できます。

| 確認対象 | コマンド |
| --- | --- |
| TypeScript の型 | `pnpm exec tsc --noEmit` |
| ESLint とアーキテクチャーゲート | `pnpm run lint` |
| webpack ビルド | `pnpm run compile` |
| Extension Host のテスト | `pnpm test` |
| Dashboard のブラウザー検証 | `pnpm run test:dashboard-ui` |
| 静的ゲートと Extension Host の参照シナリオ | `pnpm run verify:all` |

ヘッドレス Linux では `xvfb-run -a pnpm run verify:all` を使用できます。コマンドやビューを追加した場合は [機能マップ](../verification/feature-map.json) の入口を更新します。主要操作が変わる場合は、操作に対応するセレクター、確認条件、テストも更新します。

実際の Redmine で同期を確認する場合は、[ライブ検証スクリプト](../scripts/run-live-redmine-tests.cjs) と [テストシナリオ](../src/test/live/) を参照してください。ライブ検証用に用意した環境で `pnpm run test:live-redmine` を実行します。既定の出力先は `docs/reports/` です。
