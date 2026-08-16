# Revision-Fenced Durable Sync Effects 実装判断ログ

日付: 2026-08-12
ステータス: 実装・ローカル検証完了（実Redmine 6.1 E2Eは外部環境待ち）
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: `/mnt/c/Users/glory/.codex/attachments/1796ac18-3a1b-41e5-9189-33c63a7633c2/pasted-text-1.txt`
実装対象: Ticket / Comment / child / compensation / local finalization の durable lifecycle、workspaceState migration、batch outcome、production entry-point 境界

## 依頼と参照元の要約

1つの `SyncOperation` に属するすべての remote/local side effect を、同一 operation/revision の durable effect contract と freshness fence の下で開始・確定・復旧する。仕様書の I-01〜I-20、互換性、性能、CI、Redmine 6.1 E2E、README / Locale、lifecycle bypass 撤去を完了条件とする。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 lifecycle 用 compare-and-apply primitive を既存 rewrite helper から分離する

- 種別: 技術制約
- タイミング: 実装中
- 参照元に書かれていたこと: `DocumentPort` を expected freshness 付きの compare-and-apply contract に変更し、`applied / stale_source / not_available / write_failed / save_failed` を区別する。
- 参照元に書かれていなかったこと: `rewriteDocumentWithRegisteredFields` は lifecycle 外の既存呼出しと boolean 前提のテストでも利用されており、一括置換中に安全性境界が不明瞭になる。
- 判断: lifecycle owner は新設の `compareAndRewriteDocumentWithRegisteredFields` だけを使用する。旧 helper は lifecycle 外の既存呼出し用に保持するが、`DocumentPort` 自体は結果unionのみを受け入れ、boolean互換層は撤去する。
- 理由: freshness fence を先に Ticket create/update の本番経路へ適用しつつ、旧 helper の呼出し元を明示的に残して後続の境界監査対象にできるため。
- 代替案: 既存 helper の戻り値と全呼出しを同時に変更する。
- 影響: lifecycle 経路では結果種別と expected content/revision が必須になる。test doubleも結果unionを返す。
- 可逆性: 高。旧 helper は lifecycle 外の既存用途に限定される。
- 制約: 任意判断。
- ユーザー確認: 事後報告。

### D-002 batch cancellation の remaining を failure accounting に含める

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: initial plan の全 item を processed または remaining の一方へ分類し、public summary は `total = synced + failed` を満たす。
- 参照元に書かれていなかったこと: cancellation による未処理 item を public `failed` に含めるか、別の数値 field を追加するか。
- 判断: internal outcome は `plan / results / remaining` を分離し、既存公開 DTO では remaining を `failed` に含める。
- 理由: command/settings/UI contract を変えずに既存 `OfflineSyncRunResult` の等式を満たし、未処理件数を消失させないため。
- 代替案: 公開 DTO に `remaining` を追加する。
- 影響: cancelled summary の `failed` は「実行して失敗」と「未処理」を合わせた未完了件数になる。
- 可逆性: 中。将来 additive field を追加して内訳を公開できる。
- 制約: 互換性維持により必須。
- ユーザー確認: 事後報告。

### D-003 workspaceState v3 は lifecycle/effects を envelope の source of truth にする

- 種別: 仕様ギャップ
- タイミング: 実装中
- 参照元に書かれていたこと: 必要なら storage version を更新し、v1/v2 を読み込み、payload と envelope を独立した二重 source of truth にしない。
- 参照元に書かれていなかったこと: 新しい storage version 番号と payload から除外する具体的 field。
- 判断: version 3 とし、`operationId / connectionScope / phase / revision / createdAt / effects` は envelope にだけ保存する。runtime queue への復元時に payload view へ投影する。
- 理由: v1/v2 reader を維持しながら、新形式では lifecycle identity と effect ledger の競合を構造的に防げるため。
- 代替案: v2 の payload/envelope 二重保存を継続する。
- 影響: v1/v2 は normalization され、次回 persistence で v3 になる。既存 user data は保持される。
- 可逆性: 中。reader は旧形式を保持するが、v3 writer を戻す場合は envelope field の再埋込みが必要。
- 制約: 任意判断。
- ユーザー確認: 事後報告。

### D-004 comment create の remote commit checkpoint は POST と reconciliation GET の間に置く

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: remote write 前の started、POST 成功後の durable commit、ID reconciliation、`created_unresolved` の queue 保持と reconciliation-only retry。
- 参照元に書かれていなかったこと: 既存 `applyQueuedCommentUpdate` 内の POST+GET を分離せず checkpoint を差し込む方法。
- 判断: adapter に `beforeRemoteWrite / afterRemoteWrite / reconcileOnly` hook を追加し、`afterRemoteWrite` を POST/PUT 直後かつ GET 前に実行する。
- 理由: Redmine adapter の validation/upload/reconciliation ロジックを再利用しつつ、POST と GET の間の crash window を durable barrier で閉じるため。
- 代替案: Comment create/update を全面的に新serviceへ複製する。
- 影響: `created_unresolved` の再実行は GET/reconciliation のみとなり、timeout は `commit_unknown` で自動再送されない。
- 可逆性: 中。hook は adapter boundary に限定される。
- 制約: 任意判断。
- ユーザー確認: 事後報告。

### D-005 child effect identity は operation revision 内の ordinal で固定する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: child ごとに stable effect identity を持ち、最大50件で bounded、remote ID は dependent effect 前に保存する。
- 参照元に書かれていなかったこと: 同一subjectやduplicate入力を含む child effect の具体的 identity。
- 判断: 現行 `splitUniqueChildren` 後の ordinal を `child-create:{ordinal}` とし、target に parent ticket ID と ordinal を保存する。retry は committed ordinal の remote ID を再利用する。
- 理由: duplicate children の既存semanticを維持し、subject文字列の変更・hash方式に依存せず1 revision最大50 recordに固定できるため。
- 代替案: subject hash、remote ID、ランダムUUID。
- 影響: 同一 revision の順序が effect identity を決める。active revision は同期中にfreezeされるため途中でずれない。
- 可逆性: 中。migration時は legacy remote ID recordとの対応が必要。
- 制約: 任意判断。
- ユーザー確認: 事後報告。

### D-006 editor の Comment sync も queue-first とする

- 種別: 変更
- タイミング: 実装中
- 参照元に書かれていたこと: Comment create/update を共通 lifecycle owner 配下へ移し、production remote mutation path を owner からだけ呼ぶ。
- 参照元に書かれていなかったこと: auto sync の editor command で既存 direct function を残すか。
- 判断: editor はまず `OfflineCommentUpdate` を保存し、auto mode では直後に `SyncEngine.syncOne` を呼ぶ。manual mode は従来どおり queued で止める。
- 理由: auto/manual のUXを維持したまま、editor・Sync One・Sync All の remote write contract を同一化できるため。
- 代替案: direct function 内に journal hook を追加して並存させる。
- 影響: editor comment remote write も operation/revision/effect checkpoint と single result mappingを通る。
- 可逆性: 中。
- 制約: lifecycle bypass 禁止により必須。
- ユーザー確認: 事後報告。

### D-007 child POST のstatus不明エラーは補償せず commit_unknown にする

- 種別: 安全側の解釈
- タイミング: 実装中
- 参照元に書かれていたこと: responseを失ったchild POSTは自動retryせず、remote identityを一意に解決できなければ明示的recoveryを必須とする。
- 参照元に書かれていなかったこと: timeout判定と補償開始の境界。
- 判断: 明示的な非retryable HTTP statusがないエラーはcommit結果不明として扱い、親・既知childを自動DELETEしない。HTTP 400等のknown failureだけがdurable compensationへ進む。
- 理由: timeout後に実在するかもしれないchildを無視して親を削除する方が、重複POST以上にremote stateを不確定にするため。
- 代替案: child errorをすべてknown failureとして補償する。
- 影響: child effectは`commit_unknown`、operationは`reconciliation_pending`となり、通常retryはremote writeを行わない。
- 可逆性: 中。
- 制約: Q-02の実Redmine検証結果により、将来安全な自動照合を追加できる。
- ユーザー確認: 事後報告。

### D-008 single-flight はComment operation identityにも適用する

- 種別: 仕様補完
- タイミング: 実装中
- 判断: `connectionScope + operationId` をkeyに、同時Comment Sync One/Sync All/editor syncを同一Promiseへ集約する。
- 理由: started CASだけで後続呼出しを失敗させるのではなく、同一操作の呼出し元へ同じcanonical outcomeを返しつつPOST/PUTを1回に固定するため。
- 影響: 同一operationの並行呼出しは同じ結果を受け取る。
- 可逆性: 高。
- 制約: I-01/I-03により必須。
- ユーザー確認: 事後報告。

### D-009 process restart では durable `started` effect を `commit_unknown` へ正規化する

- 種別: 安全側の復元規則
- タイミング: 最終監査中
- 判断: v3 effect ledgerの `started` は、process restart後に `commit_unknown` として復元する。また existing ticket が `preparing` でも committed/unknown child effectを持つ場合は operation/effectを保持し、一律queued化しない。
- 理由: request送信後・result保存前のprocess終了ではremote commit有無を判定できず、通常retryへ戻すとduplicate POSTが成立するため。
- 影響: remote childを持つ `preparing` は明示recoveryまたは既知ID再利用から再開する。remote effectのないlegacy `preparing` は従来どおりqueuedへ戻す。
- 可逆性: 低。I-02/I-14を満たすための必須安全規則。
- ユーザー確認: 事後報告。

### D-010 Comment recovery linking はGET検証済みjournal IDだけを受け入れる

- 種別: Security / recovery validation
- タイミング: 最終監査中
- 判断: Comment `commit_unknown` / `created_unresolved` はGETで ticket ID、journal ID、normalized body、current authorを照合する。一意候補は自動reconcileでき、曖昧な場合はユーザー指定journal IDを同じ条件で検証した場合だけlinkする。
- 理由: 同一bodyの複数commentを誤linkせず、永久滞留するqueueには安全な明示復旧手段を提供するため。
- 影響: 通常remote write retryは0回のまま。GET失敗、author不明、body不一致、複数候補ではcheckpointを保持する。
- 可逆性: 中。
- ユーザー確認: 事後報告。

### D-011 新規Comment draftはremote identityをMarkdownへdurable finalizationしてからcompleteする

- 種別: 最終監査で発見した仕様補完
- タイミング: 最終監査中
- 判断: editor由来の新規Comment operationに `finalizeDraft` を持たせ、作成後はticket/journal/project/source hashをcomment-update frontmatterへcompare-and-applyする。閉じた・非表示・変更済みdocumentではqueueを `local_finalize_pending` に保持する。
- 理由: queueだけを削除するとrestart後に `new-comment` filenameが再び新規draftと認識され、同じcommentを再POSTできるため。
- 影響: 同期中の後続編集はfrontmatterのbodyとして保持し、remoteへcommit済みbodyのhashをbaselineにしてnext comment-update intentへ昇格する。
- 可逆性: 低。I-08/I-20とduplicate防止に必要。
- ユーザー確認: 事後報告。

## 変更・逸脱

- `markdownTicketCreateService` に残っていた未使用の直接create APIを撤去し、preview専用moduleに縮小した。productionの実処理は既に `TicketSyncService.syncEditor` を通っていたため、command/UX contractへの影響はない。
- Comment prompt/add/edit/conflict-local-priorityもqueue-firstで `SyncEngine` を通すよう統一した。

## 妥協点と残課題

- Q-01 upload tokenの永続性・orphan挙動、Q-02 child timeout後のremote identity照合は、実Redmine 6.1環境がないため未確定。現実装は安全側に、child timeoutを`commit_unknown`として自動再送・自動補償しない。uploadは仕様のQ-01どおり実サーバーで永続性が確認されるまではeffect ledger対象外である。
- 実Redmine 6.1を用いるticket/comment create/update、child create、connection abort、restart recovery E2Eは外部環境待ち。リポジトリにはE2E harness、server URL、test credentialは存在しない。

## 検証と制約

- 実行した検証: CodeGraph index正常。`pnpm run compile-tests`、`pnpm run compile`、`pnpm run lint`、`pnpm exec tsc --noEmit`、`git diff --check` green。VS Code 1.133.0 Extension Host 873 tests、最低サポート版1.107.0 Extension Host 873 testsがgreen。I-01〜I-20をID付き自動testで直接対応。finalizer race、comment draft identity finalization、manual journal link、comment file freshness、batch cancellation、Durable Effect state machine、v1/v2→v3 migration、parent/child effect checkpoint、checkpoint書込み失敗、compensation failure、Comment created_unresolved/timeout/single-flight、Ticket/Comment 10,000 saves、50 childrenを検証。
- 実行できなかった検証: 実Redmine 6.1 E2E。対象環境・test credential・E2E harnessが提供されていないため。

## 結果

コード実装とローカル/Extension Host検証、最終横断reviewは完了。仕様のリリースgateである実Redmine 6.1 E2Eのみ外部環境待ち。
