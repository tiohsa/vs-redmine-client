# 同期の障害復旧と競合

## リモート結果と再試行

- 送信結果が不明な操作は `commit_unknown` として保持します。`commit_unknown` と再試行不可の失敗は自動再送の対象外です。復旧ポリシーが明示的な再試行を許可した場合は、凍結済みの `RequestSnapshot` を再利用します。
- 新規チケットの作成 POST が 403 で拒否された場合、保存済みリクエストを確認できる項目には「再同期」を表示します。接続先と対象の試行を照合し、同じ接続先の現在の認証情報で凍結済みのリクエストを送ります。同じ試行に対する同時実行を抑止し、後続の編集を別に保持します。再度拒否された場合は最新の失敗理由を表示します。作成準備で失敗した項目は準備から再開します。
- 受理を確認できた操作は、再取得・照合やローカル確定など残っている段階から復旧します。添付・子チケットなどの Effect はそれぞれの確定状態と実行世代を確認します。
- `remote_write_started` のまま実行中の試行には復旧操作を提示しません。再起動時に開始済み書き込みが `commit_unknown` として復元された後に、状態に応じた復旧操作を提示します。未解決の画像・添付が残っている場合は Primary の明示的な再試行を保留します。
- `local_finalize_pending` 状態のチケット更新を復旧する際、対象ファイルが閉じられていてもローカルから開ける場合は開いて確定を再試行します。ファイルが存在しない場合や内容が乖離している場合は保留理由を示し、確認モーダルで「ローカルファイルの更新をスキップして同期を完了」するかキャンセルかを選択できます。
- 必要な確定情報が欠ける場合、整合条件を満たさない場合、安全な操作を提示できない場合は `manual_repair_required` として理由を表示します。効果の対象が不明なリモートデータの自動削除や通常の同期による前進を防ぎます。
- 試行終了の判定では現在の世代を確認します。同じ世代のリビジョン不一致、Primary Effect の重複、リモートの同一性を確認できない場合は、試行終了を保留します。Primary の補償結果が不明な間は、Secondary Effect を前進させる操作を提示しません。
- 新規チケット作成時に子チケットの送信結果が不明になった場合は、その子の再送を保留し、残りの子チケットを処理した後に Effect 台帳から復旧待ちを判定します。子チケットの補償は保存済みのプロジェクト情報で照合します。検証は [子チケットの作成と補償](../../src/test/ticketChildSaga.test.ts) を参照してください。

## 競合の確認

既存チケットの更新は基準・ローカル編集・最新のリモート内容を比較します。競合の内容と利用可能な解決方法を表示し、差分確認やローカル／リモートを優先する選択を扱います。解決時にも対象操作と基準を照合し、古い差分や別の試行からの確定を拒否します。

[チケットの競合解決](../../src/views/ticketConflictResolution.ts) と [コメントの競合解決](../../src/views/commentConflictResolution.ts) は、文書とキューを対応付けて更新します。キュー更新に失敗した場合、[文書への反映処理](../../src/views/conflictResolutionEditor.ts) は、書き換え後に追加編集がなければ元の内容を復元します。

## 破棄と中止後の編集

- 未送信の変更は、復旧ポリシーが許可する場合に破棄できます。結果不明やリモート受理済みの状態では、通常の破棄で復旧情報を消去できません。Dashboard は状態に応じて利用可能な操作を提示します。
- 中止した操作と表示上の中止記録を保持します。新しく編集を始める際は、接続先のトランザクション内で `ticketId`、`documentUri`、`editSessionId` を紐付けた編集許可を保存します。中止した文書には再許可しません。
- 編集許可のある文書で有効な操作が存在しない状態から保存すると、新しい操作 ID を発行します。許可は同期完了や再起動を越えて保持され、その文書の操作を中止する時点で取り消します。旧 v3 データで中止記録と現在の操作が共存する場合は、現在の操作の文書から許可を復元します。
- 中止記録の恒久削除は専用の操作で行い、確認後に対象を再照合します。Dashboard では 1 件または全件の中止記録を削除できます。一括削除は全対象を照合してから同じトランザクションで保存します。
- 現在の操作または明示的な編集許可がある間は現在の状態を表示します。中止記録だけが残るときは、旧下書きの失敗や競合より `Abandoned` を優先します。

実装は [復旧ポリシー](../../src/app/syncEffects/recoveryPolicy.ts)、[同期コーディネーター](../../src/app/ticketSync/syncCoordinator.ts)、[競合解決](../../src/views/conflictResolver.ts)、[破棄・中止と記録の削除](../../src/views/offlineSyncDiscard.ts) を参照してください。検証は [Dashboard の復旧ポリシー](../../src/test/dashboardRecoveryPolicy.test.ts)、[競合解決時の照合](../../src/test/syncConflictResolutionCas.test.ts)、[確定時の世代照合](../../src/test/syncAttemptClosurePersistenceFence.test.ts)、[同期トレイ](../../src/test/dashboardSyncTray.test.ts)、[中止記録の一括削除](../../src/test/forgetAllAbandoned.test.ts) を参照してください。

復旧の実行は [結果不明の照合と再試行](../../src/app/ticketSync/syncCommitUnknownRecovery.ts)、[ローカル確定](../../src/app/ticketSync/syncLocalFinalizeRecovery.ts)、[個別の Effect](../../src/app/ticketSync/syncEffectRecovery.ts) が扱います。

[未同期項目の同期入口](../../src/commands/syncUnsyncedFile.ts) は選択した接続先のスコープで操作し、[Primary の復旧](../../src/commands/unsyncedPrimaryRecovery.ts)、[Secondary Effect の復旧](../../src/commands/unsyncedSecondaryRecovery.ts)、[ローカル確定の確認](../../src/commands/unsyncedLocalFinalize.ts) に処理を渡します。
