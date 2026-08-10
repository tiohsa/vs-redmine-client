# Revision-aware Ticket Sync Lifecycle 実装判断記録

- 日付: 2026-08-10
- ステータス: 実装完了
- 関連計画: `docs/planning/2026-08-10-revisioned-ticket-sync-lifecycle.md`
- 対象 commit: `11df07f8c2dca1a664129fedfd665cb9239212b2`

## 判断一覧

### D-001 Lifecycle ownership

- 判断: revision-aware operation repository/reducer を同期 lifecycle の唯一の mutation owner とし、全 production entry を移行する。
- 根拠: pending payload overwrite、phase-blind discard、Dashboard bypass、restart duplicate は同じ ownership 欠如から派生する。
- 代替: 個別 if、storeのみ、DTOのみ、全面再設計。
- 影響: commands、save、Dashboard、sync-one/all、new/update finalizer、restart/discard。
- 維持: command/settings/URL、connection scope、conflict、canonical mapping。
- 再検討: 小さい変更で全 invariant と caller closure を証明できた場合。

### D-002 Revision model

- 判断: active write snapshot を不変とし、later save は最大1個の coalesced next intent に保存する。
- 根拠: remoteへ送った内容と最新user intentを分離し、メモリ/保存量を有界化する。
- リスク: rebase conflict。
- 軽減: A/C/L three-way rule、whole-field conflict、state-machine test。
- 再検討: 全履歴監査が要件化された場合。

### D-003 Commit uncertainty

- 判断: write前markerと`commit_unknown`を設け、明示解決までautomatic POST/PUTを禁止する。
- 根拠: external side effect と local acknowledgement 間のcrash gapはclient journalだけでは消せない。
- 代替: timeout再送、成功扱い。
- リスク:手動復旧。
- 軽減:operation token調査、link+GET verification、明示resend。
- 再検討:server idempotency key/lookupが利用可能になった場合。

### D-004 Canonical rebase

- 判断: committed snapshot、remote canonical、latest desired をthree-way比較する。
- 根拠: canonical反映とlater edit保全を両立するため。
- 代替: remote/localの全置換、last-write-wins。
- リスク:field semantics。
- 軽減:field fixture、description whole-field conflict、validation再実行。

### D-005 Persistence ordering

- 判断:同一connection scopeのMemento mutationを最大1 in-flightで直列化する。
- 根拠:reverse completionによるrestart state巻戻しを防ぐ。
- 代替:URI lockのみ、global scope横断lock。
- リスク:短い待機増加。
- 軽減:API処理のURI independenceを維持し、commit laneのみ直列化。

### D-006 Phase-aware discard/presentation

- 判断:未送信intentのみ通常discard、remote checkpoint/unknownはrecoveryとして表示する。
- 根拠:discardでcreatedIssueIdを失うとduplicate POSTが再発する。
- 代替:全record削除、server issue自動削除。
- リスク:操作制限。
- 軽減:additive action/status、Help/Locale、next-only discard。

### D-007 Scope boundary

- 判断:comment syncはrevision model外、共有Memento ordering内とする。
- 根拠:根本原因に必要なdurability境界だけを閉じ、unrelated redesignを避ける。
- 再検討:comment remote lifecycleに同種問題が実証された場合。

### D-008 Test authority

- 判断:actual production adaptersを通るentry parityとstate-machine/API counterをcompletion gateにする。
- 根拠:callerのないlegacy helperやservice direct label testではbypassを検出できない。
- リスク:test setup増加。
- 軽減:shared fixture/portsを再利用。

### D-009 Compatibility/storage

- 判断:DBを追加せず、既存Memento keyにadditive fieldsとread normalizationを適用する。
- 根拠:既存dataとextension contractを維持するため。
- リスク:old record ambiguity。
- 軽減:safe-side pending/unknown、reload matrix。
- 再検討:Mementoがcapacity/durability gateを満たせない場合。

## 結果

仕様策定を完了した。実装は未着手。採用方針の変更は、仕様書第24節の再検討条件を満たす新しいコード上の事実、環境制約、性能測定、互換性上の証拠が得られた場合に限る。
