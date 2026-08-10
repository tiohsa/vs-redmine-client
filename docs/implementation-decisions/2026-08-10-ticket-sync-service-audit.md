# TicketSyncService 再設計仕様の完了監査 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: ユーザー提示「vs-redmine-client 同期アーキテクチャ再設計・修正指示」
実装対象: `src/app/ticketSync/`、ticket/new-ticket queue adapter、save sync、関連テスト

## 依頼と参照元の要約

同期transaction ownershipを `TicketSyncService` に集約し、remote create once、durable-before-complete、one synchronization semantics、remote canonical after commit、explicit connection ownershipを全入口と全failure boundaryで保証する。対象branchの最新実コードを正とし、実入口を通るfailure/retry/parity testsと全ローカルゲートを成功させる。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存commitを最新対象branch上で再監査する

- 種別: 技術制約
- タイミング: 実装前
- 参照元に書かれていたこと: `fix-20260810` の最新実コードを正とする。
- 参照元に書かれていなかったこと: 先行して作成済みの `f5a5507` を破棄して最初から実装し直すか。
- 判断: fetch後に `origin/fix-20260810=e510c1d` と `merge-base=e510c1d` を確認し、直上1commitの既存実装を要件単位で監査・修正する。
- 理由: 対象branchとのdivergenceはなく、既存state machineとtestsを捨てる利益がない。一方、既存commitの存在を完了証拠にはせず新仕様との直接照合を行う。
- 代替案: `origin/fix-20260810` から別branchを作り直してcherry-pickまたは再実装する。
- 影響: 既存commitに不足修正commitを積む形になる。
- 可逆性: 高。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-002 ticket syncとcomment syncの境界を維持する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: `TicketSyncService` へticket/new-ticket同期を集約する。
- 参照元に書かれていなかったこと: comment transactionも同serviceへ移すか。
- 判断: ticket/new-ticketだけをserviceへ集約し、comment pipelineは既存経路を維持する。
- 理由: 仕様のstate machine、outcome、必須testsはticketを対象としており、comment統合はunrelatedな拡張になる。
- 代替案: generic sync serviceへcommentsも統合する。
- 影響: `offlineSync` はticket resultsのpresentationとcomment既存処理を担当する。
- 可逆性: 高。
- 制約: 仕様範囲により必須
- ユーザー確認: 不要

### D-003 application serviceはqueue keyからoperationを解決する

- 種別: 設計
- タイミング: 実装中
- 参照元に書かれていたこと: `syncQueueItem(key, context)` と `syncAll(context)` の公開API、Sync AllはSync This Fileと同じuse caseを使う。
- 参照元に書かれていなかったこと: stale UI keyが指すentryが既に消えている場合の扱い。
- 判断: service内でexplicit scopeのstoreをlookupし、見つからない場合は `failed_before_commit` + `TicketSyncQueueItemNotFoundError` を返す。adapterは従来のUI互換性のため `undefined` へ変換する。
- 理由: transaction stateのownerをapplication serviceに限定しつつ、stale UI itemをremote failureと誤表示しないため。
- 代替案: adapterがoperationをlookupしserviceへ渡す。
- 影響: Sync This FileとSync Allは完全に同じqueue-item implementationを通る。
- 可逆性: 中。
- 制約: 仕様により必須
- ユーザー確認: 不要

### D-004 開いているvisible editorはeditor.editのbooleanを必ず検査する

- 種別: 実装
- タイミング: 実装中
- 参照元に書かれていたこと: `editor.edit()` と `document.save()` のfalseをlocal finalize failureとする。
- 参照元に書かれていなかったこと: 開いているがvisibleでないdocumentの書き換え手段。
- 判断: visible editorは既存 `applyEditorContent()` で `editor.edit()` を検査し、非visibleのopen documentは `workspace.applyEdit()` のbooleanを検査する。両方ともsave必要時は `document.save()` も検査する。
- 理由: VS Codeの両編集経路でfailureを消さず、remote committedとlocal completeを区別するため。
- 代替案: 常に `workspace.applyEdit()` を使う。
- 影響: falseの場合はqueueが `local_finalize_pending` で残り、retry可能になる。
- 可逆性: 高。
- 制約: 仕様により必須
- ユーザー確認: 不要

## 変更・逸脱

- 実装順序のbaselineは、先行commitが存在したため `origin/fix-20260810` のdetached worktreeで後から再構成した。対象branchの実コードと指定コマンドで実行し、759 passing / 3 failingを記録した。
- commentsはTicketSyncServiceの外に残した。今回のticket/new-ticket transaction ownershipには影響せず、仕様範囲の拡張を避けるためである。

## 妥協点と残課題

- child ticket compensationは既存rollbackを維持し、operation journalへの `createdChildIds` 耐久化は対象外とした。
- custom fieldsのcanonical mapper拡張は、Redmine API/model側の将来課題とした。

## 検証と制約

- 実行した検証: target branch fetch/merge-base確認、lockfile install、baseline lint/typecheck/compile/test、実装後lint、`tsc --noEmit`、compile-tests、compile、Extension Host全test、`git diff --check`。
- 実装後結果: 789 passing / 0 failing。
- 実行できなかった検証: なし。

## 結果

実装とローカル検証は完了。
