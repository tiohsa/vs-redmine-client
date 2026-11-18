# 保存とオフライン同期

## 操作の入口

`redmine-client.offlineSyncMode` の `auto` は新規・既存チケットとコメントの保存内容をキューに記録して同期を試み、`manual` は後で同期できるようキューに記録します。新規チケットの作成が HTTP 403 で拒否された場合、保存や一括同期では再送せず、原因を解消した後に Unsynced または同期トレイから「再同期」を選びます。Dashboard の Unsynced、同期トレイ、エディタおよびコマンドパレットの同期操作から明示的に同期できます。キューの対象は既存チケット更新、新規チケット、コメント追加・更新です。

保存時は文書の種類に応じて変更を分類し、同じ文書の保存要求を直列化します。保存処理で得た入力と実行中の同期の所有関係を維持します。リモート書き込み中に次の編集を保存した場合は、現在実行中の入力を維持し、後続の編集を別の意図として保持します。

## 永続状態

- `connectionScope` ごとにキューを分離します。更新は scope transaction 内で最新状態を読み取り、操作 ID・バージョン・世代などを照合し、候補を更新・永続化してからメモリに公開します。保存に失敗した場合は旧状態を維持します。
- トランザクション候補と公開 snapshot は、ネストした Effect や `RequestSnapshot` の変更が保存前の状態に波及しないよう分離します。通常の操作更新は `mutateOfflineSyncQueueAsync()` を経由します。
- 旧キュー、操作形式、世代情報を読み込む移行経路を維持します。以後の遷移では古い `revision` や `attemptGeneration` のコールバック、再試行、完了処理を永続化前に拒否します。

## リモート書き込みと完了

1. 操作の入力と書き込みに必要な [添付の識別情報](attachments.md) を確定します。
2. リモート書き込みを開始します。Primary Operation の phase と Primary Effect の状態は `SyncOperationRepository.transitionPrimaryRemoteWrite` で原子的に遷移します。
3. Redmine から結果を再取得し、受理済みの内容とローカル状態を照合します。
4. ローカル文書と下書きの確定を行います。後続編集があれば確定した内容を基準に反映します。ローカルの確定に失敗した場合も書き込み結果を保持し、[復旧](sync-recovery.md) に引き継ぎます。

Effect の進行は単調かつ冪等にします。補償として定義した遷移でのみ `planned` への巻き戻しを扱います。書き込みの受理後からローカル確定までの間も、同期トレイまたは Unsynced に復旧対象を表示します。

実装は [保存キュー](../../src/app/saveSyncQueue.ts)、[同期エンジン](../../src/app/syncEngine.ts)、[コーディネーター](../../src/app/ticketSync/syncCoordinator.ts)、[同期リポジトリ](../../src/app/ticketSync/syncRepository.ts)、[永続ストア](../../src/views/offlineSyncStore.ts) を参照してください。検証は [ストアのトランザクション](../../src/test/offlineSyncStoreTransactions.test.ts)、[世代](../../src/test/syncAttemptGenerationM01toM10.test.ts)、[ローカル確定の復旧](../../src/test/syncLocalFinalizationRecovery.test.ts) を参照してください。

新規チケットの同期では、本文の `mode` が省略されていても、ステータスが空の場合は一覧を取得せず `status_id` を省略します。指定時は一覧から ID を解決し、取得に失敗した場合は作成しません。VS Code コマンドと Dashboard の一括同期では、一覧取得または作成の HTTP エラーについて操作名とステータスを結果通知に表示します。作成結果が不明な HTTP エラーは復旧待ちとして扱います。許可された明示的再試行では凍結済みリクエストを使用し、ステータス一覧を再取得しません。
