# 接続先と API キー

- `redmine-client.baseUrl` に Redmine のベース URL を設定します。サブパスに設置された Redmine ではそのパスも含めます。HTTPS を使用し、HTTP は `localhost`、`127.0.0.1`、`::1` に限ります。クライアントは許可されない HTTP への送信を拒否します。
- API キーは設定・削除・状態表示コマンドまたは Dashboard の設定から管理します。VS Code の `SecretStorage` に正規化済み `connectionScope` のハッシュで保存し、別の接続先へ引き継ぎません。旧キーの移行は既存の移行処理を経由します。
- `ignoreSSLErrors` の既定値は `false` です。有効化すると証明書エラーを無視するため、開発・テスト環境に限定します。
- 接続先変更時は Dashboard の接続依存状態と現在のキューを切り替えます。編集文書は接続先への紐付けを維持します。接続先を特定できない旧文書は、接続先を明示的に割り当ててから操作します。下書き・キュー・操作・永続 Effect は接続先ごとに分離します。

実装は [接続スコープ](../../src/config/connectionScope.ts)、[API キーストア](../../src/config/apiKeyStore.ts)、[Redmine クライアント](../../src/redmine/client.ts)、[編集文書レジストリ](../../src/views/ticketEditorRegistry.ts) を参照してください。検証は [API キーストア](../../src/test/apiKeyStore.test.ts)、[接続スコープ](../../src/test/connectionScope.test.ts)、[Dashboard の接続切り替え](../../src/test/dashboardConnectionReset.test.ts) を参照してください。
