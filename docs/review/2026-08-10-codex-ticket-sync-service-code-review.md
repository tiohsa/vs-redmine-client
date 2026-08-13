# Code Review: codex/ticket-sync-service

## Scope

- 対象: `origin/fix-20260810` (`e510c1d`) .. `codex/ticket-sync-service` (`11df07f`)
- GitHub: PR #53 (`codex/ticket-sync-service` → `main`)
- 差分: 2 commits、32 files、+3167/-543（`origin/fix-20260810` 基準）
- 優先した根拠: HEAD実コード、HEAD対応CI、現行テスト。過去の計画書・実装判断ログは補助資料とした。

## Findings

### P1 確定: remote commit後の新しいローカル編集が再同期時に失われる

- 発生条件:
  1. 新規チケットのPOST、または既存チケットのPUTが成功する。
  2. GET/rewrite/saveが失敗し、operationが `reconciliation_pending` または `local_finalize_pending` で残る。
  3. ユーザーが同じMarkdownをさらに編集し、再同期前または同期中に保存する。
- 実際の結果: storeは後続編集の `content` / `subject` / `description` / `metadata` を同じoperationへ上書きする一方、pending phaseと `createdIssueId` を維持する。retryはPOST/PUTを意図的にスキップし、GETしたremote canonicalでMarkdownを書き換えてqueueを完了する。後続編集はRedmineへ送信されず、ローカルからも失われる。
- 根拠:
  - `src/views/offlineSyncStore.ts:238-260`: existing-ticket payloadを上書きしつつnon-queued phaseを保存する。
  - `src/views/offlineSyncStore.ts:342-355`: new-ticketの新しいcontentを、`createdIssueId` / pending phase付きentryにmergeする。
  - `src/views/ticketSync/ticketQueueSync.ts:350-362`: pending phaseはPUTを実行せずreconcileへ進む。
  - `src/app/ticketSync/newTicketFinalizer.ts:118-197` と `ticketReconciler.ts:74-172`: remote canonicalをrewrite後、queueを完了する。
- 影響: ユーザーが明示的に保存した件名、本文、metadataが無警告で消失する。新規・既存、direct・Sync This File・Sync Allに影響する。
- 修正方向: remote-committed operationのimmutable payload/revisionと、その後に発生したnext intentを別レコードまたは別revisionで保持する。reconcile完了後もnext intentはqueueに残し、別PUTとして競合検査する。

### P1 確定: POST成功とcreatedIssueIdの耐久化の間に、restart後の二重作成を防げない区間が残る

- 発生条件: `createIssue()` 成功後、`Memento.update()` 完了前にExtension Host/OSが終了する、またはjournal書き込みがrejectする。
- 実際の結果: serviceは `remote_committed` を返すが、次回起動時の永続queueに `createdIssueId` がない場合は `createOrResumeWithScope()` が再度POSTする。Redmine側のidempotency keyやoperation IDによるrecovery lookupはない。
- 根拠:
  - `src/app/ticketSync/ticketSyncService.ts:293-338`: POST後に `markNewTicket()` を呼び、失敗時はIDを耐久化できないまま終了する。
  - `src/views/offlineSyncStore.ts:456-468`: in-memory entry更新後にMemento完了をawaitするため、reject/restart後の永続状態は保証されない。
  - 現行restart testはMemento書き込み成功後だけを対象にする。
- 影響: 稀なタイミングだが、同一内容のRedmine issueを重複作成する。「remote create once」はjournal成功後に限って成立する。
- 修正方向: POST前にstable operation IDと `commit_unknown` 相当を耐久化し、不確定なoperationは自動再POSTしない。可能ならRedmine側へoperation tokenを保存しlookupで回復する。不可能なら手動reconciliationを要求する。

### P2 確定: direct editorのno-change経路はremote canonical stateを取得しない

- 発生条件: 既存ticket editorのローカル内容がdraft baselineと同じ状態でdirect syncする。
- 実際の結果: `queueTicketDraft()` が `no_change` を返すと `syncEditor()` はそのまま返却し、`TicketReconciler` / `getIssueDetail()` を通らない。statusやupdatedAtなどのremote changeがMarkdown/draftに反映されない。
- 根拠: `src/app/ticketSync/ticketSyncService.ts:203-215`。`src/test/ticketSaveSync.test.ts:52-94` のcanonical no-change testはlegacy helper `syncTicketDraft()` だけを通し、production commandのservice経路を通さない。
- 影響: no-change syncをremote refreshとして使えず、後続編集で古いbaselineによるconflictが発生する。
- 修正方向: direct no-changeもshared reconcilerに流し、GET成功時だけ `no_change` としてcanonical stateを確定する。

### P2 推論: fire-and-forgetのqueue永続化は異なるURIの並行保存で古いsnapshotを最後に書く可能性がある

- 発生条件: 同scopeの異なるURIが独立に保存され、同じMemento keyへ複数の `persist()` が重なる。
- 実際のリスク: `persist()` は先行promiseをchainせず `persistenceByScope` を置き換える。Mementoが呼び出し順の書き込みを保証しない場合、古いsnapshotが後から完了し、restart後にqueue itemが欠落する。
- 根拠: `src/views/offlineSyncStore.ts:156-169`。異なるURIを独立処理するテストはあるが、Memento completionを逆順にする永続化testはない。
- 影響: 発生すればoffline queueの未送信データがrestart後に欠落する。
- 修正方向: synchronous mutationもscopeごとのwrite chainに追加し、latest snapshotが最後に永続化されることを逆順completion testで固定する。

## Open Questions

- Redmine issueのcustom fieldまたはdescription markerへstable operation IDを送り、POST結果不明時のlookupに使うことは製品仕様上許容されるか。
- pending reconciliation中の追加編集は「次のupdate intentとして保存」が期待仕様か、UIで編集禁止して明示的に復旧を要求するか。データ消失はどちらの仕様でも許容できない。
- VS Code `Memento.update()` に同一key書き込みのcompletion order保証があるか。実装はその保証を型/API契約として表現していない。

## Summary

TicketSyncServiceへの集約、Sync This File / Sync Allの共通化、POST/PUT後のGET retry、canonical mapping、explicit connection scopeは実装されている。一方、operation recordが「すでにremote commitしたintent」と「後続の未送信編集」を分離できず、現実的な一時failure後にユーザーデータを失う。また、remote POSTとlocal journalの分散transaction gapに対するcommit-unknown戦略がない。この2点によりmerge/release readyとは判定できない。

## Verification

- PR #53 HEAD SHA: `11df07f8c2dca1a664129fedfd665cb9239212b2`
- GitHub Actions run `31355062061`: lint、typecheck、compile-tests、compile、VS Code Extension Host testsすべて成功。`789 passing / 0 failing`。
- PR状態: OPEN、MERGEABLE、CI SUCCESS。
- ローカルの前回HEAD検証: lockfile install、lint、`tsc --noEmit`、compile-tests、compile、789 testsが成功。
- 検証限界: Redmine実サーバーへのE2E、process-kill/Memento I/O failure injection、Memento逆順completionは未実施。
