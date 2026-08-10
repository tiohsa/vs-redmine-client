# Revision-aware Ticket Sync Lifecycle 変更仕様書

- 日付: 2026-08-10
- ステータス: 実装完了
- プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
- 調査基準: branch `codex/ticket-sync-service`, commit `11df07f8c2dca1a664129fedfd665cb9239212b2`
- 比較基準: `origin/fix-20260810` (`e510c1dc...`) から 2 commits ahead

## 1. 目的

- 解決する問題: Redmine 書込み後の reconciliation / local finalize 待ち期間に新しい編集、Discard、restart、別 entry point の操作が入ると、ユーザーの新しい意図または remote commit の durable checkpoint が失われ、更新消失・重複 POST・誤った完了判定が起こり得る。
- 局所修正では不十分な理由: `OfflineNewTicket` / `OfflineTicketUpdate` が、変更可能な最新編集内容、remote write の不変 checkpoint、UI queue item、document identity を同じ record に保持し、Commands、Dashboard、save、sync-one、sync-all、discard が個別にその record を更新・削除している。特定 retry に `if` を足しても、別 producer や Discard が同じ不変条件を破る。
- 本変更後に成立させる状態: 同一 document/ticket の同期を revision 付き operation lifecycle として一元管理し、remote write 開始後の payload は不変、新しい編集は次 revision として保全、remote commit の有無が不明な操作は自動再送せず、全 entry point が同じ transition API を利用する。

## 2. 対象

- Repository: `tiohsa/vs-redmine-client`
- Branch / Commit: 最新実コード `codex/ticket-sync-service` / `11df07f8...`。元の対象 `fix-20260810` に対する追加変更として扱う。
- 対象機能: editor save、Dashboard sync/metadata/discard、Sync This File、Sync All、auto save、manual/offline queue、new-ticket create、existing-ticket update、remote reconciliation、local finalization、queue persistence/restart。
- 対応環境: VS Code `^1.107.0`、Node.js 22（CI）、TypeScript 5.9、Redmine 6.1 を現行基準として維持する。
- DB migration: 不可。外部 DB は追加しない。
- API 互換性: 既存 command ID、settings key、Markdown URL/control fields、Redmine API contract、保存済み Memento の読込み互換を維持必須。内部型・webview message は additive 変更可。
- 制約: SecretStorage、connection/API-key snapshot、legacy editor assignment、conflict detection、project metadata validation、save concurrency、child rollback を維持する。event sourcing、message broker、DI container、外部 DB、全面 UI 刷新は行わない。
- 作業制約: 本仕様策定では外部 System 書込み、commit、push、PR、データ削除、実装変更を行わない。

## 3. 現状

### 確定事項

- HEAD は `11df07f8...`。PR #53 は open/mergeable、最新 GitHub Actions run `31355062061` は success、現行 test は 789 passing。
- `TicketSyncService` が sync-one / sync-all の主要 orchestration を集約し、`syncAll()` は queue item ごとに `syncQueueItem()` を呼ぶ。通常の create resume では `createdIssueId` を見て POST を回避する。
- POST/PUT 成功後の GET または local finalize 失敗は phase と remote ID を保存して retry でき、正常 retry は write を再送しない。
- ただし pending record への新しい save は同一 record の payload/content を更新し、既存 phase と `createdIssueId` を保持する。retry は pending phase のため write を省略し、remote canonical rewrite により後から保存した payload を失い得る。
- Dashboard metadata 更新は store の追加 API を直接呼び、同期 service の transition ownership を迂回する。非表示 document の `workspace.applyEdit()` の boolean も確認せず、queue/draft 更新と成功表示へ進み得る。
- Dashboard Discard は phase を問わず queue record を削除する。remote-created / reconciliation-pending record の `createdIssueId` を消した後、Markdown が `new-ticket` のままなら、次回同期は新規 POST を再実行し得る。
- unsynced Dashboard / Tree item は `queued` と `remote committed but pending` と `commit unknown` を表示・action availability 上で区別できない。
- POST/PUT と durability checkpoint の間で process crash または `Memento.update()` failure が起きると、restart 後の record には remote ID/commit marker がなく、自動再送を抑止できない。
- store persistence は mutation ごとに await 可能でも、異なる URI の並行 mutation を同一 scope の Memento key に completion-order で直列化していない。古い snapshot が後から完了する可能性がある。
- direct existing-ticket sync は local diff がない場合、remote GET/reconciliation を行わず `no_change` を返す。legacy helper の test はあるが、実 production entry の canonical refresh を保証しない。
- production から未使用の旧 sync helper を直接 test する test があり、actual adapter parity の証明になっていない。entry-point parity test の `editor` / `dashboard` label も両方 service を直接呼び、Dashboard adapter 自体を通さない。

主なコード根拠:

| 事実 | 最新コード上の経路 |
|---|---|
| pending record の payload 上書き | `src/views/offlineSyncStore.ts` の existing/new ticket enqueue・merge |
| pending retry が PUT を省略 | `src/views/ticketSync/ticketQueueSync.ts` の queued update resume |
| POST後 durability gap | `src/app/ticketSync/ticketSyncService.ts` の create flow と `src/views/offlineSyncStore.ts` の Memento persistence |
| Dashboard metadata の直接 mutation | `src/dashboard/services/DashboardMetadataService.ts` |
| phase 無視の Discard | `src/dashboard/services/DashboardUnsyncedService.ts` |
| phase 非表示 | `src/dashboard/viewModels/unsyncedDashboardViewModel.ts`、`src/views/unsyncedFilesView.ts` |
| no-change 早期完了 | `src/app/ticketSync/ticketSyncService.ts` の existing editor sync |
| production adapter を通らない parity test | `src/test/ticketSyncEntryPointParity.test.ts` と legacy sync helper tests |

### 強い推論

- 同一 connection scope 内の異なる URI が並行 save されたとき、Memento update の完了順が逆転すると最後の durable snapshot が古くなり、restart 後に一部 operation が消える可能性が高い。明示的 reverse-completion test はない。
- PUT の transport timeout 等で server commit 有無が不明な場合、現行の失敗分類では安全な自動 retry と危険な再送を十分区別できない。child create を伴う operation は特に再送を idempotent とみなせない。

### 要確認

- Redmine または利用中 API wrapper が client operation token の保存・検索を提供できるか。確認方法: Redmine 6.1 API と custom-field 運用制約を調査し、使えなければ本仕様の conservative manual recovery を採用する。
- 実運用で Dashboard Discard を remote committed pending に対して許容したいか。安全側の既定は checkpoint 削除禁止であり、別 semantics が必要なら server ticket 削除権限・監査・confirmation を別仕様化する。
- PR #53 の base が `main` でよいか。実装対象の比較基準は依頼どおり `fix-20260810` とし、merge 戦略はリポジトリ owner が確認する。

## 4. 期待仕様

- 正常系: 1 revision につき parent POST/PUT は最大 1 回。write 後は remote canonical detail を取得し、Markdown、registry、draft baseline、queue を同じ結果へ確定する。
- 後続編集: write 開始後に到着した編集は実行中 payload を変更せず、次 revision として保持する。active revision 完了後に canonical state を base として promotion する。
- 異常系: write 前の validation/4xx は `failed_before_commit`、確定済み remote commit 後の GET/local failure は retryable pending、commit 可否不明は `commit_unknown` として分離する。
- retry: remote ID/commit marker がある revision は POST/PUT しない。`commit_unknown` は自動 write しない。
- 並行更新: sync 開始時 revision snapshot より後の save を今回の完了処理で削除・上書きしない。stale completion は expected revision check で拒否する。
- rollback: write 前 failure は queued intent を保つ。remote commit は local rollback 対象にしない。child create failure の既存 compensation は維持する。
- Discard: 未送信 revision のみ通常 discard 可能。remote checkpoint は通常 discard で削除しない。uncertain operation は解決 workflow を要求する。
- Compatibility: 旧 queue は additive default で読み、`phase` 欠落を queued、`created_rewrite_failed` を local-finalize-pending 相当へ normalize する。
- Performance: queue processing は開始時 item/revision 数に対して O(N)。同期中に追加された revision を追い続けない。active + next は identity ごと最大 2 snapshot。

## 5. 根本原因

### 症状から根本原因まで

1. 後続編集が canonical rewrite で消える
   → pending record の mutable payload を上書きする一方、phase は pending のまま
   → remote に送った snapshot と最新 user intent を識別できない
   → operation record が「同期 transaction」と「最新 draft queue」を兼務している。

2. remote-created pending を Discard 後に重複 POST できる
   → caller が phase 無視で record を削除できる
   → discardable intent と non-discardable remote checkpoint の owner が同一かつ unrestricted
   → lifecycle transition が application service / repository に閉じていない。

3. crash / persistence failure 後に remote write を再送し得る
   → external side effect と durable acknowledgement の間に不可避の gap がある
   → `write_started` / `commit_unknown` と recovery policy がない
   → local Memento だけで exactly-once を断定している。

4. Dashboard、no-change、actual entry test の意味論が異なる
   → adapter が store/draft/document を直接更新し、service の共通 transition を迂回する
   → public mutation contract が複数あり、旧 helper test が残る
   → sync lifecycle の ownership と entry-point contract が未完全集約。

5. 並行 persistence で restart state が古くなり得る
   → snapshot write が scope ごとに serialization されない
   → memory mutation order と durable completion order が一致しない
   → persistence repository に ordering invariant がない。

### 共通する状態・契約・責務

- `OfflineNewTicket` / `OfflineTicketUpdate` と Memento key
- create/update payload、base canonical revision、phase、createdIssueId、documentUri
- save producers、Dashboard metadata、sync-one/all、discard、restart、finalizer
- remote write acknowledgement、reconciliation、document rewrite、draft/registry/queue completion

## 6. 影響範囲

### 状態ライフサイクル

編集生成 → validation/normalization → queue enqueue → sync snapshot → conflict check → remote write 開始 checkpoint → POST/PUT → commit確定/不明 → GET reconciliation → canonical mapping → document edit/save → registry/draft更新 → active完了/next promotion → restart/retry/discard。

### Extension/Application/Infrastructure

- Commands: sync-to-Redmine、sync-unsynced-file、offline sync、Markdown header create、conflict force-local。
- Services: `TicketSyncService`、queue sync/create/update/reconciler/finalizer、save executor、Dashboard composer/metadata/unsynced service。
- State: offline sync store、ticket/new-ticket draft store、editor registry、connection-scoped Memento。
- Ports: Redmine API、document/editor edit/save、operation repository、connection context。
- Pure mapping: remote detail → `TicketEditorContent`、frontmatter/control fields、metadata validation。
- Comments queue: ticket intent state machine には含めない。ただし同じ Memento snapshot を共有するため persistence serialization の対象に含める。

### Dashboard/Webview

- unsynced item type/view model、phase/status/action availability、Discard/Sync presentation。
- metadata edit の visible/non-visible document 適用結果、draft/queue更新順序。
- locale strings と README/Help の retry/recovery/discard 説明。

### Test/CI/Document

- Unit: reducer/repository、normalization、rebase、outcome mapping。
- Integration: actual command/Dashboard/save adapters、Memento restart/failure、API call counter。
- E2E相当: VS Code document edit/save false、scope switch、concurrent URI。
- CI: lint、strict typecheck、test compile、webpack compile、all tests。
- 文書: README/README.ja、Help/Locale、operation phase compatibility、recovery guidance。

## 7. 代替案比較

| 案 | 内容 | 利点 | 残る問題 | 新しいリスク | 判定 |
|---|---|---|---|---|---|
| A | retry/discard 各所へ条件分岐 | 最小差分、短期 P1 抑止 | 後続編集、迂回 producer、commit unknown、persistence race が残る | phase 条件の増殖 | 不採用 |
| B | store のみ revision 化 | durable model は改善 | Dashboard/adapter の直接操作、no-change、outcome/UI contract が残る | 新旧 API の混在 | 不採用 |
| C | 中核 DTO/reducer のみ統一 | transition を test しやすい | lifecycle 全入口が reducer を使う保証、actual parity、recovery action が不足 | bypass による不変条件破壊 | 単独では不採用 |
| D | revision model + repository transition + 全 entry/finalize/discard/restart を統合 | 全症状を同じ ownership で閉じ、横断 test が可能 | adapter移行・compatibility normalization が必要 | scope増大、migration bug | 採用 |
| E | event sourcing/DB/API/UI 全面再設計 | 履歴・監査を最大化 | 現行 VS Code/Memento 構造に過剰、互換性と工数が悪化 | 新規故障領域が最大 | 不採用 |

- 採用案: D。ただし generic framework は導入せず、C の小さな revisioned model/reducer/repository を中心に lifecycle 全経路だけを移行する。
- 不採用理由: A/B/C は mutation bypass または uncertain commit を残し、E は根本原因の境界を越える。
- 再検討条件: Redmine が強い server-side idempotency key を正式提供する、Memento で required durability を達成不能と計測される、または additive schema で旧データ互換を保てないことが実証された場合。

## 8. 設計方針

### 共通状態モデル（概念契約）

```ts
interface TicketSyncRecord {
  operationId: string;
  connectionScope: string;
  identity: { kind: "new" | "existing"; ticketId?: number; documentUri?: string };
  active: SyncRevision;
  nextIntent?: SyncIntentSnapshot;
}

interface SyncRevision {
  intent: SyncIntentSnapshot;
  phase:
    | "queued"
    | "remote_write_started"
    | "commit_unknown"
    | "remote_committed"
    | "reconciliation_pending"
    | "local_finalize_pending";
  remoteTicketId?: number;
  remoteUpdatedAt?: string;
}

interface SyncIntentSnapshot {
  revision: number;
  payload: TicketIntentPayload;
  baseCanonical?: TicketEditorContent;
  baseRemoteUpdatedAt?: string;
  createdAt: number;
}
```

- 名称・file配置は概念例。契約と invariant は固定する。
- `active.phase !== queued` になった後は active intent を変更しない。新しい save は `nextIntent` へ coalesce する。
- 1 identity につき active + next の最大 2 snapshots とし、event log は作らない。

### 共通更新経路

- operation repository/reducer に `enqueueIntent`、`beginRemoteWrite`、`markCommitted`、`markCommitUnknown`、`markReconciliationPending`、`markLocalFinalizePending`、`completeAndPromoteNext`、`discardPendingIntent`、`resolveCommitUnknown`、`snapshot` 相当を持たせる。
- application adapter は raw add/remove/phase mutation を呼ばない。
- `syncAll` は開始時 queue snapshot を取り、各 key + max revision を `syncQueueItem` へ渡す。後着 revision は次回へ残す。

### Rebase/finalization

- active write snapshot A、remote canonical C、最新 desired L の field-wise three-way rebase を行う。
- `L == A`: user は変更していないので C を採用。
- `L != A && C == A`: L を保持。
- `L != A && C != A`: field conflict。L/document を破壊せず conflict outcome として残す。
- description は既存の安全な merge contract がない限り field 全体を単位とする。
- new ticket は canonical frontmatter へ変換後、next delta があれば existing-ticket update intent として C を base に promotion する。

### Commit unknown

- POST/PUT 前に `remote_write_started` を await persist する。
- transport timeout/process interruption 等で server commit を否定できない場合は `commit_unknown`。自動 retry の write 回数は 0。
- server-side operation token が使えない既定では、既知 ticket ID の link + GET verification、または remote 未作成を確認した明示的再送の recovery action を提供する。通常 Sync/Discard で checkpoint を消さない。

### Compatibility/移行

- DB migration なし。Memento record は additive fields と read-time normalization で移行する。
- 旧 record は queued、`createdIssueId` ありは remote committed/pending、`created_rewrite_failed` は local-finalize-pending と解釈する。
- 移行完了時に production caller が旧 raw mutation helper を使わないよう private/deprecate/remove する。保存済み data reader は残す。

## 9. 不変条件

| 分類 | Test可能な不変条件 |
|---|---|
| Entity | `(connectionScope, operationId)` は一意。同一 identity の active は常に 1 以下、next は 1 以下。 |
| Revision | active write 開始後、その payload/revision は変更されない。新しい intent の revision は active より大きい。 |
| Remote create once | remote commit が確定した revision から parent POST/PUT を再実行しない。通常 retry call count は 0。 |
| Unknown commit | `commit_unknown` からの自動 POST/PUT は常に 0。明示 recovery transition なしに queued へ戻さない。 |
| Durable-before-write/complete | write 開始 marker を remote call 前、remote ID/commit marker を local finalize 前に await persist する。 |
| Intent preservation | sync 開始後に追加された revision は active completion/rewrite/discard で失われず、完了後も queue または conflict として観測できる。 |
| Canonical | commit + GET 成功後の baseline/control fields は remote canonical C。later intent は C 上の delta として保持する。 |
| Scope | API、Memento、draft、registry/document resolution は開始時 `connectionScope` を明示利用し、途中の current connection 変更に影響されない。 |
| Freshness | expected operation/revision が一致しない stale completion は state を変更しない。 |
| Concurrency | 同一 URI save serialization/debounce を維持。異なる URI の sync は独立。同一 scope の Memento update は最大 1 in-flight。 |
| Rollback | remote commit は local failure で取り消した扱いにしない。child create failure の既存 compensation は維持。 |
| Discard | remote checkpoint を通常 discard で削除しない。未送信 next intent のみ安全に削除可能。 |
| Pagination | sync queue は開始時 finite snapshot を処理し、後着 revision を追跡し続けない。ticket list の既存 limit/pagination semantics は変更しない。 |
| Resource | identity あたり snapshot 最大 2、queue N に対し stored intent snapshot 最大 `2N`、処理は O(N)。 |

## 10. Backend変更

本リポジトリに server backend はないため、ここでは extension application/infrastructure を backend 相当として定義する。

- 入力: Editor/Dashboard/queue content を共通 `TicketIntentSnapshot` へ normalize。document identity、base canonical、remote revision、scope を含める。
- Validation: project-specific tracker/metadata、legacy editor assignment、ticket ID、connection scope を write 開始前に検証する。
- Service: create/update/reconcile/finalize を revision-aware use case に統合し、sync-one/all/editor/dashboard が同じ transition を呼ぶ。
- Transaction: local ACID を仮定せず、各 transition を awaitable durable barrier とする。revision compare による optimistic CAS 相当を使う。
- Callback: editor edit/save/workspace edit の boolean false を failure として扱い、state/draft を成功更新しない。
- Response: completed、remote_committed pending、commit_unknown、queued、conflict、failed_before_commit を UI adapter で明示変換する。
- Error: HTTP definite rejection と transport uncertainty を分ける。GET/local failure は write failure と混同しない。
- Permission: Redmine credentials/API権限は現行 contract を維持。uncertain recovery の link/retry は confirmation と検証を要求する。
- Locking: scope persistence lane を直列化し、URI save lock とは分離する。
- Query: API call count を第14節の gate 内に制限する。Redmine GETは reconciliation/conflict に必要な回数のみ。

## 11. Frontend変更

- Type: unsynced item に lifecycle category (`queued` / `recovery_pending` / `commit_unknown`) と `hasNextIntent`、利用可能 action を additive に公開する。
- Normalization: UI は raw phase を推測せず application outcome/presenter から表示 model を得る。
- State: Dashboard metadata save も `enqueueIntent` を通し、active pending の payload を直接変更しない。
- Reducer: queue list update は operation revision/key を基準にし、stale response で新しい item を消さない。
- Optimistic update: document edit が成功した場合のみ draft/queueへ反映する。visible/non-visible editor で同じ boolean semantics を使う。
- Rollback: local edit failure 時は draft/queue表示を成功状態にしない。remote commit pending は recovery item として残す。
- Freshness: action response に expected revision を結び、別 save 後の古い sync/discard response を無視する。
- Cache/LocalStorage: 新規 browser storage は追加しない。Memento/SecretStorage の既存 scope separation を維持する。
- UI影響: queued は従来どおり Sync/Discard。remote committed pending は Resume/Finalize を表示し checkpoint discard を禁止。commit unknown は Resolve を表示し通常 Sync/Discard を禁止。command ID は変更しない。
- Locale/Help: phase と「server ticket は自動削除されない」「uncertain write は自動再送しない」を英日で説明する。

## 12. API／DTO契約

- Request: `syncEditor` / `syncQueueItem` / `syncAll` は開始時 `SyncContext` を受け、operation/revision snapshot を内部 request に含める。
- Response: `TicketSyncOutcome` に `commit_unknown`、pending revision、conflict/recovery reason を additive に表現する。`TicketSaveResult` への adapter は legacy UI contract を壊さない。
- Version: public extension command/settings の versioning は変更しない。internal DTO は additive schema version または presence-based normalization とする。
- Compatibility: field 欠落、旧 status、`documentUri` 欠落を受理する。unknown future field は破壊せず無視する。
- Error: `failed_before_commit`、`commit_unknown`、`remote_reconcile`、`local_finalize`、`editor_edit_failed`、`document_save_failed` を区別する。
- Invalidation: completion は expected revision 一致時だけ active を remove/promote。next がある場合 record 全体を削除しない。
- Pagination cursor: sync queue に cursor API は新設しない。将来必要なら `(operationId, revision)` の stable cursor とし、処理中 enqueue を現在 page に混入させない。

## 13. Data／DB

- Migration: DB migration なし。DB、index、repair job、external storage を追加しない。
- Memento: additive fields (`operationId`, revision snapshots, phase, timestamps, identity) を保存する。旧 key と connection-scope partition を維持する。
- Write ordering: scope ごとの promise chain/commit lane で `Memento.update` を直列化し、各 mutation は自分の snapshot が durable になるまで resolve しない。
- Isolation: 異なる scope は別 lane/key。current active scope fallback は application layer で使用しない。
- Cleanup: completed かつ next なしの record のみ削除可能。pending/unknown checkpoint は retention する。
- Data repair: old `createdIssueId` entry は remote write 済みとして復元。矛盾 record は自動 POST せず recovery pending として表示する。
- Comments: ticket revision model 外の既存 shape を維持するが、共有 Memento write ordering には参加させる。

## 14. Performance仕様

- Dataset: queue `N=0,1,1,000`、identity ごとの burst save、child `0,1,50,51` を fixture 化する。
- API calls: existing update は parent PUT 最大 1、pre-conflict GET + post-write GET 最大 2。new create は parent POST 最大 1、post-write GET 最大 1。pending retry は write 0、reconcile GET 最大 1。commit_unknown automatic retry は write 0。
- Child: 現行上限 50 と rollback を維持し、parent invariant とは別に既存 child call 上限を適用する。
- Rows/DB: DB query/row は 0。本仕様で DB を導入しない。
- Memory/Node: queue N に対し intent snapshots 最大 `2N`。1 identity に履歴を無制限蓄積しない。
- Batch: `syncAll` は開始時 snapshot の item/revision だけを順次処理する。同期中 enqueue を無制限に追わない。
- Depth: child hierarchy の現行対応を変更しない。新しい再帰構造を追加しない。
- Response size: webview unsynced DTO は payload全文の追加複製を行わず O(N)。phase/action metadata のみ additive。
- Persistence: 同一 scope の `Memento.update` in-flight は常に 1。異なる URI の API処理はこの lane の待機以外は並行可能。
- CI gate: 100 seeds × 100 operations 以上の deterministic state-machine test、N=1,000 の O(N)/`<=2N` assertion、API call counter を必須とする。wall-clock は診断値であり primary gate にしない。
- Timeout: 既存 request timeout default 30,000ms と設定互換を維持する。

## 15. Security／Permission

- Authentication: API key は SecretStorage のまま。plain Memento/Markdown に保存しない。
- Authorization: Redmine server の project/tracker/status/assignee 権限を迂回しない。既存 API error を definite rejection として扱う。
- Visibility: connection A の operation/draft/queue/API key を B に表示・送信しない。
- Workflow: project-specific tracker validation、status metadata contract、remote conflict check を弱めない。
- CSRF: extension の現行 Redmine API client contract を維持。新規 web endpoint は追加しない。
- Input validation: recovery で入力された ticket ID は numeric validation、connection scope、GET result/project/document identity を検証する。
- Sensitive data: recovery/error log に API key または full secret header を出さない。
- Scope spoofing: webview から scope を任意指定させず、host が開始時 context と item ownership を照合する。

## 16. Compatibility

- Supported Version: VS Code `^1.107.0`、Node 22 CI、TypeScript 5.9、Redmine 6.1 を基準とする。
- API: Redmine URL、request形式、既存 command ID、settings key を変更しない。
- DB: なし。migration なし。
- Browser/Client: VS Code extension/webview の現行 browser target と CSP を維持する。
- Existing data: phase/revision/documentUri のない Memento、旧 status、Windows/URI表現を読める。
- Existing Markdown: `new-ticket` / `ticket-update` frontmatter/control fields、URL形式を読める。canonical rewrite は既存 mapper/serializer を利用する。
- Existing preferences: auto/manual save、ticket list limit 1–500、request timeout、connection settings を変更しない。
- Legacy editor: current connection へ自動割当しない。明示 assignment を要求する現行安全仕様を維持する。

## 17. Test仕様

### 再現Test（実装前に red を確認）

1. PUT success → GET failure → 同一 document を再編集/save → retry。旧 revision は PUT 1 回、後続 revision は promotion 後 PUT 1 回、後続編集が Markdown/draft に残る。
2. POST success → GET/rewrite failure → 再編集/save → sync-one / sync-all / restart retry。parent POST total 1、作成 ID を保持し、後続 delta は update intent になる。
3. remote-created pending → Dashboard Discard。checkpoint/createdIssueId が残り、次回 parent POST 0。
4. write transport uncertainty → restart → Sync。明示 resolve 前 POST/PUT 0。
5. 2つの Memento update を reverse completion させ、後の logical mutation が restart 後も残る。

### Unit

- old record normalization、revision monotonicity、active immutability、next coalescing。
- three-way rebase の unchanged/local-only/remote-only/both-conflict。
- phase transition matrix と invalid transition rejection。
- outcome → UI/save result mapping。

### Integration/API

- API stub call counter で create/update/GET/child delete 回数を検証する。
- `editor.edit=false`、`workspace.applyEdit=false`、`document.save=false`、Memento reject、GET timeout を failure injection する。
- actual `syncEditorToRedmine` no-change が GET canonical を反映する。
- Dashboard metadata が pending active を上書きせず next を作る。

### Actual entry-point parity

- editor command/save executor、DashboardComposerService、DashboardUnsyncedService、Sync This File、Sync All、Markdown header create、auto/manual save、force-local conflict の production adapter を通す table-driven test を作る。
- 共通 postcondition: remote call count、active/next、draft baseline、registry、Markdown controlFields/canonical metadata、scope、outcome。
- label だけ変えて service を直接呼ぶ test は parity の証明に数えない。

### State-machine / Concurrency

- operations: enqueue、begin-write、commit、unknown、GET fail/success、local fail/success、save-next、discard、resolve、restart、scope switch、stale completion。
- 100 seeds × 100 steps 以上。各 step 後に第9節の invariant を検証する。
- sync 中 save、同一 URI serialization、異なる URI independence、scope persistence reverse completion を含める。

### Boundary/Compatibility

- queue 0/1/1,000、child 0/1/50/51、空/null、重複 key、reverse order、repeat、timeout、stale revision、wrong scope、legacy missing URI/phase、Windows URI。
- old Memento reload と `created_rewrite_failed` compatibility。
- Redmine 6.1 fixture と VS Code `^1.107.0` test runtime。Node 22 CI。

### CI commands

```text
pnpm run lint
pnpm exec tsc --noEmit
pnpm run compile-tests
pnpm run compile
pnpm test
```

既存 test は削除・弱体化しない。production caller のない helper test は actual entry test へ置換後に helper を private/remove する。

## 18. 実装順序

1. HEAD/CI baseline と既存 789 tests を記録する。
2. 第17節の P1 再現 test を production entry 経由で追加し、現行で red を確認する。
3. additive read normalization と revisioned state/reducer/repository contract を追加する。
4. scope persistence lane と awaitable transition barrier を実装し、restart/reverse tests を green にする。
5. create/update の begin-write/committed/unknown/reconcile/finalize を共通 service へ移行する。
6. later-intent rebase、complete-and-promote、phase-aware discard を追加する。
7. editor/save/commands/sync-one/all/header/Dashboard metadata/composer/unsynced の全 producer/action を repository API へ移行する。
8. actual entry parity、concurrency、state-machine、performance tests を追加する。
9. production caller のない旧 orchestration/helper を撤去または private 化する。
10. README/README.ja/Help/Locale と compatibility note を更新する。
11. 全 CI、diff review、P0/P1 invariant audit を行う。

途中状態は main へ merge しない。additive model 追加だけで旧/new mutation path が混在する段階は feature branch 内に留め、全 production entry 移行と tests green を同一 merge unit とする。

## 19. 維持すべき仕様

- Sync This File と Sync All は同じ queue-item use case を利用する。
- remote canonical mapping、subject/description/status/tracker/priority/assignee/dates/updatedAt の反映。
- remote updatedAt conflict detection と force-local の明示性。
- connection scope と API key を operation 開始時に固定する `runWithConnectionScope` semantics。
- SecretStorage、scopeごとの durable offline queue、VS Code restart recovery。
- 同一 URI debounce/serialization、異なる URI independence。
- `editor.edit` / `document.save` false を完了扱いしない。
- project-specific tracker validation。
- child create failure 時の delete compensation と上限 50。
- command ID、settings key、Redmine URL、Markdown format、legacy editor assignment safety。
- auto/manual save と既存 Dashboard/Unsynced のユーザー操作。phase に応じた安全制限だけを additive にする。

## 20. 非目標

- child ticket を完全な durable saga/event journal にすること。ただし将来 `createdChildIds` を journal 化できる構造を妨げない。
- custom fields の新機能追加。
- Redmine server/plugin の変更、外部 DB、message broker、CQRS/event sourcing framework。
- unrelated Dashboard UI刷新、ticket list pagination 再設計、検索/表示性能の一般最適化。
- server ticket の自動削除を Discard semantics に追加すること。
- comment sync を ticket intent revision model に統合すること。共有 persistence ordering の修正は scope 内。

## 21. 要確認事項

| 確認対象 | 確認方法 | 結果による仕様への影響 |
|---|---|---|
| Redmine operation token/idempotency | Redmine 6.1 API・運用 custom field・proxyを検証 | 利用可能なら `commit_unknown` の自動照合を追加。不可なら manual recovery を維持 |
| PUT unknown の安全な照合 | intended fields と GET canonical/updatedAt の比較 fixture | 適用済みを一意に証明できる field のみ自動 committed 化。曖昧なら明示解決 |
| PR #53 base | repository owner が target branch strategy を確認 | 実装内容は不変。merge/rebase手順のみ変更 |
| Dashboard recovery UX wording | locale/Help review と user test | command ID は維持し、文言/action availability のみ調整 |
| Memento failure semantics | VS Code 1.107 API behavior と injected rejection test | reject/termination双方で conservative phase を選ぶ。ordering invariant は不変 |

確認できない項目があっても、安全側の `commit_unknown` 自動再送禁止を弱めて実装してはならない。

## 22. 完了条件

- P0/P1: 本 root cause に属する既知 P0/P1 が 0。later intent loss、discard checkpoint loss、restart duplicate、unknown auto-resend の再現 test が green。
- Architecture: 全 production mutation producer が共通 transition repository/service を使い、raw lifecycle add/remove が application adapter に残らない。
- Invariants: 第9節の全項目を unit/integration/state-machine test が直接 assertion する。
- CI: lint、typecheck、compile-tests、compile、全 tests が成功し、既存 assertion を弱めていない。
- Performance: N=1,000、`<=2N`、Memento in-flight 1、API call上限、10,000 operation state-machine gate を満たす。
- Compatibility: old Memento/Markdown/legacy editor/settings/commands を matrix test で確認し、DB migration なし。
- Document: README英日、Help/Locale、recovery/discard semantics、internal compatibility note を更新。
- Review: actual entry-point parity と all mutation caller search を別 reviewer が確認する。

## 23. リリース不可条件

次の一つでも残れば merge/release しない。

- remote write 済みまたは commit unknown revision から通常 Sync が自動 POST/PUT する。
- active write payload を後続 save が変更できる、または後続 revision が canonical rewrite/Discard で消える。
- remote checkpoint を通常 Discard が削除できる。
- Dashboard/command/save のいずれかが lifecycle store を直接 add/remove/phase mutationする。
- scope persistence write が逆順完了でき、restart snapshot を巻き戻せる。
- actual entry test ではなく private/legacy helper test だけで parity を主張している。
- connection/API key snapshot、conflict detection、child rollback、legacy editor safety の回帰。
- 旧 Memento/Markdown を破壊する migration、command/settings/URL の無断変更。
- API call/resource上限または state-machine test が CI gate にない。
- P0/P1、要確認の安全側 fallback、文書更新が未完了。

## 24. 決定記録

### D-001: lifecycle 全体を revision-aware operation に統合する

- 決定: 案Dを採用し、共通 model/reducer/repository を全 entry/finalize/discard/restart へ適用する。
- 理由: payload loss、duplicate、discard、persistence race、entry divergence を同じ ownership で説明・防止できる最小境界だから。
- 却下案: A/B/C は bypass を残し、E は過剰。
- リスク: 移行途中の新旧 path 混在。
- 軽減策: feature branch 内で一括移行し、caller search + actual parity test を gate にする。
- 再検討条件: より小さい案が全 invariant と全 production entry を同等以上に証明した場合のみ。

### D-002: immutable active + coalesced next の最大2 snapshot

- 決定: write開始後 active は不変、新規 save は next に coalesce。
- 理由: later intent を保全しつつ event log の無制限増加を避ける。
- 却下案: active payload overwrite、全 save event 永続化。
- リスク: field conflict/rebase complexity。
- 軽減策: three-way rule と whole-field conflict、state-machine test。
- 再検討条件: 監査要件で全 revision 履歴が必須になった場合。

### D-003: commit unknown は自動再送しない

- 決定: pre-write marker と `commit_unknown` を導入し、明示 recovery まで POST/PUT 0。
- 理由: client-only journal では external side effect と acknowledgement 間の exactly-once を保証できない。
- 却下案: timeoutを失敗とみなし自動再送、無条件成功扱い。
- リスク: user intervention が必要。
- 軽減策: operation token 調査、link/verify/resend UX、明確な説明。
- 再検討条件: server-side idempotency/recovery lookup が利用可能になった場合。

### D-004: canonical state と later intent をthree-way rebaseする

- 決定: A/C/L比較で canonical adoption、local preservation、conflictを決める。
- 理由: remote canonical と後続ユーザー編集を同時に守る必要がある。
- 却下案: canonicalで全置換、localで全置換、暗黙last-write-wins。
- リスク: metadata field semantics の誤判定。
- 軽減策: field単位 fixture、description whole-field conflict、project validation再実行。
- 再検討条件: Redmine が field revision/merge contract を提供した場合。

### D-005: Memento更新をscope単位で直列化する

- 決定: logical mutation order と durable completion order を一致させ、最大1 in-flightとする。
- 理由: queue全体 snapshot の逆順完了は restart correctness を破る。
- 却下案: URI単位だけのlock、fire-and-forget、global全scope lock。
- リスク: persistence待ちの増加。
- 軽減策: API処理はURI独立のまま、短い persistence commitのみscope lane化し計測する。
- 再検討条件: atomic compare-and-set storageへ移行した場合。

### D-006: DiscardとUnsynced UIをphase-awareにする

- 決定: queued intentだけ通常discard、checkpoint/unknownはrecovery actionへ誘導する。
- 理由: UI convenience がremote safety invariantを破ってはならない。
- 却下案: 全phase削除、server ticket自動削除。
- リスク: 従来より操作が制限される。
- 軽減策: additive status/action、英日Help、next intentだけdiscard可能にする。
- 再検討条件: permission/監査付きserver compensationが別仕様で承認された場合。

### D-007: comment lifecycleは非統合、persistence orderingのみ共通

- 決定: comments は ticket revision model の非目標だが同じ Memento laneを使う。
- 理由: semantic scopeを広げずdurability raceだけ閉じる。
- 却下案: commentsも同時に全面state-machine化、commentsをordering外に置く。
- リスク: repository boundaryが曖昧になる。
- 軽減策: ticket reducerとgeneric scope persistence laneを分離testする。
- 再検討条件: comment側に同種のremote commit lifecycle不具合が確認された場合。

### D-008: production entry testを正としlegacy helperを撤去する

- 決定: actual adapter parityを必須にし、callerのないhelper testは置換後にremove/private化。
- 理由: helper greenはUI/adapter bypassを保証しない。
- 却下案: labelだけのservice direct table、private helper testのみ。
- リスク: test setup増大。
- 軽減策: shared fixture/port stubとcall counterを再利用する。
- 再検討条件: adapterがcompile-time generatedでserviceと同一と証明できる場合。

### D-009: DBなし・additive互換を維持する

- 決定: Memento additive schema/read normalizationで移行する。
- 理由:既存保存data、VS Code extension model、依頼制約を守る。
- 却下案: external DB、破壊的schema/key変更。
- リスク: old record ambiguity。
- 軽減策:安全側pending/unknown normalization、compatibility matrix。
- 再検討条件: Memento容量・durabilityが第14節gateを満たせない測定結果が出た場合。
