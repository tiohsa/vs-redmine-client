# Revision-aware Ticket Sync Lifecycle 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `docs/planning/2026-08-10-revisioned-ticket-sync-lifecycle.md`、添付レビュー、ユーザー提示の同期アーキテクチャ再設計仕様
実装対象: TicketSyncService、offline operation store、create/update reconciliation、Dashboard/command/save adapters、同期回帰テスト

## 依頼と参照元の要約

Redmineへの外部副作用、remote reconciliation、Markdown/draft/registry/queueのlocal finalizationを単一の同期ユースケースとして扱い、全entry pointでcreate/update once、canonical state、explicit connection ownership、failure/restart retryを保証する。追加レビューで判明した後続編集、phase-blind Discard、Memento write orderingも同じlifecycle ownershipの問題として閉じる。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存実装を増分拡張する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: TicketSyncServiceとdurable lifecycleを唯一の同期境界にする。
- 参照元に書かれていなかったこと: HEADには既にTicketSyncService、phase、createdIssueId durability、canonical finalizerの大部分が実装済みである。
- 判断: 現行service/store contractを置換せず、revision separation、commit uncertainty、phase-aware mutation、persistence orderingを増分追加する。
- 理由: 既にgreenな789 testsと公開adapter互換を維持し、同期境界以外の変更を避けるため。
- 代替案: planning documentの概念modelを別repositoryとして全面的に追加する。
- 影響: 既存phase/dataをadditive normalizeし、移行中の二重source of truthを作らない。
- 可逆性: 中
- 制約: 制約により必須
- ユーザー確認: 不要

### D-002 同一operationをactive revisionとnext intentへ分離する

- 種別: 設計判断
- タイミング: 実装中
- 参照元に書かれていたこと: remote commit後のlocal failureをretry可能にし、同期中の後続編集を失わない。
- 参照元に書かれていなかったこと: 同一documentへの連続saveをqueue上でどの粒度まで保持するか。
- 判断: remote write開始前に確定したpayloadをactive revisionとして凍結し、同期中に到着した保存は単一の`nextIntent`へcoalesceする。active完了時はremote canonicalをbaseにnext intentを再構成し、次revisionとして昇格する。
- 理由: remote結果と異なるpayloadを同一operationの完了処理で削除する競合を防ぎ、queueサイズを保存回数に比例させないため。
- 代替案: 保存ごとにjournal entryを追加する、または最新payloadでactiveを上書きする。
- 影響: additiveな`revision`/`nextIntent` fieldをoffline operationへ追加。10,000回の連続更新でもactive+nextの2 snapshotだけを保持する。
- 可逆性: 中
- 制約: データ安全性とresource上限から採用
- ユーザー確認: 不要

### D-003 remote write開始checkpoint後の通信失敗はcommit_unknownとして停止する

- 種別: 設計判断
- タイミング: 実装中
- 参照元に書かれていたこと: POST/PUT成功後のGET失敗はwriteを再送せずreconcileから再開する。
- 参照元に書かれていなかったこと: timeoutやprocess終了でHTTP応答自体を観測できない場合のserver-side commit判定方法。
- 判断: POST/PUT直前に`remote_write_started`をdurable保存し、timeout、408、429、5xx、restart時の同phaseを`commit_unknown`へ正規化する。通常Sync/Sync Allはwriteを再送せず、ユーザーの明示的なretry、または新規ticket IDのlink／既存ticketのassume-committed recoveryだけを許可する。
- 理由: Redmine APIに利用可能なidempotency keyがなく、応答欠落後の自動再送はcreate重複またはupdate二重適用を防げないため。
- 代替案: timeout時に自動再送する、または全エラーをfailed-before-commitと扱う。
- 影響: `TicketSyncOutcome`とoffline phaseへadditiveな`commit_unknown`を追加。Dashboard/Treeはrecovery pendingとして表示しremote checkpointの破棄を抑止する。
- 可逆性: 中
- 制約: 外部副作用安全性を優先
- ユーザー確認: 不要

### D-004 Memento書込みをconnection scope単位のpromise laneへ直列化する

- 種別: 設計判断
- タイミング: 実装中
- 参照元に書かれていたこと: durability barrierに必要なMemento更新をawait可能にし、scopeを同期全体で固定する。
- 参照元に書かれていなかったこと: 既存同期APIと新規async APIが混在する期間のwrite ordering。
- 判断: 同期・非同期store mutationを同一scope laneへ投入し、常にsnapshotを取得した順で`Memento.update()`する。同一Mementoで即時再初期化された場合はpending snapshotを読み戻す。
- 理由: 遅い旧writeが新しいstateを上書きするrestart regressionを防ぎ、既存同期API互換も維持するため。
- 代替案: 全call siteを一括async化する、またはfire-and-forgetを残す。
- 影響: scope間は独立、同一scopeは最大1 write in-flight。DB migrationなし。
- 可逆性: 中
- 制約: 保存済みデータ/API互換から採用
- ユーザー確認: 不要

### D-005 commit_unknown recoveryは既存Sync操作から提示する

- 種別: UI/API互換判断
- タイミング: 実装中
- 参照元に書かれていたこと: command ID、settings key、URL形式を変更しない。
- 参照元に書かれていなかったこと: recovery専用commandを追加するか。
- 判断: 個別Syncを再実行した時だけmodalで明示選択を求め、Sync Allは安全に停止する。新規ticketは既存IDのGET検証後linkでき、既存ticketはGET-only reconciliationまたは明示retryを選べる。
- 理由: 新command/public contractを増やさず、無人のbulk処理による重複writeを禁止するため。
- 代替案: recovery専用command IDの追加、Sync Allでの自動retry。
- 影響: 既存command IDとDashboard protocolは維持し、presentation fieldのみadditiveに追加。
- 可逆性: 高
- 制約: command/API互換から採用
- ユーザー確認: 不要

### D-006 remote canonicalと後続local intentが同一fieldを変更した場合はlocal intentを次revisionへ保持する

- 種別: 仕様解釈
- タイミング: 実装中
- 参照元に書かれていたこと: canonical stateをlocal baselineとし、後続編集を消失させない。
- 参照元に書かれていなかったこと: remote workflow変更と同期中のlocal編集が同じfieldに重なった場合の専用UI契約。
- 判断: current revisionのMarkdown/draft baselineはremote canonicalで確定し、同期中に行われたlocal変更は次revisionへ保持する。次revisionは既存のupdatedAt conflict checkを通る。
- 理由: local editを黙って破棄せず、今回の変更境界内に新しいfield-level conflict UIを導入しないため。
- 代替案: remote優先でlocal editを破棄する、またはmetadata field別の新conflict UIを追加する。
- 影響: `ticketIntentRebase`をpure mapperとして追加。未変更fieldはremote canonical、変更fieldはlocal intentとなる。
- 可逆性: 高
- 制約: UI全面変更を非目標とするため
- ユーザー確認: 不要

## 変更・逸脱

- Planning上の独立したfield-level conflict markerは追加せず、同一fieldの後続local intentを次revisionとして保持した（D-006）。既存のticket-level optimistic conflict契約とUI互換を優先した逸脱。

## 妥協点と残課題

- child ticket作成・rollbackは既存compensationを維持し、child IDのdurable saga journal化は対象外。
- custom fieldsの同期mapping追加は対象外。ただしcanonical mapperとintent reducerへ局所追加できる境界を維持した。
- Redmine server-side idempotency tokenが将来利用可能になった場合は、`commit_unknown`の自動解決方針を再検討できる。

## 検証と制約

- 実行した検証: `pnpm install --frozen-lockfile`、`pnpm run lint`、`pnpm exec tsc --noEmit`、`pnpm run compile-tests`、`pnpm run compile`、`pnpm test`。
- テスト結果: 805 passing。create/update once、rewrite/save failure、GET-only retry、restart、commit_unknown、entry-point parity、connection scope、concurrency、10,000 mutationのbounded queueを確認。
- 実行できなかった検証: 実Redmine serverを用いるE2EとGitHub Actionsはlocal実装検証時点では未実行。push後にActionsを確認する。

## 結果

TicketSyncServiceをsync transaction ownerとして維持しつつ、durable revision、commit uncertainty、canonical rebase、phase-aware discard、scope別Memento serializationを追加した。既存保存形式・command ID・settings・URLを破壊せず、全local testを通過した。
