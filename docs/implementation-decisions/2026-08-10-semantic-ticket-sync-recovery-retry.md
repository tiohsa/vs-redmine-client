# Ticket Sync semantic Recovery Retry 実装判断ログ

日付: 2026-08-10
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`
参照元: 添付 `pasted-text.txt`（PART B: GPT-5.6 Luna Middle 最終実装指示）
実装対象: `src/app/ticketSync/`、`src/views/offlineSyncStore.ts`、Ticket Sync lifecycle tests

## 依頼と参照元の要約

Ticket Sync lifecycle mutationを、identity・scope・expected revision・expected source phaseを検証するsemantic transition contractへ統一する。通常同期のpre-remote abortと`commit_unknown`からのExplicit Retryを分離し、Retryではlater `nextIntent`を昇格せずoutcome不明のactive revision自体を再送する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 lifecycle mutation を discriminated semantic action に統一する

- 種別: 技術制約
- タイミング: 実装中
- 参照元に書かれていたこと: Production codeからtarget phaseをbusiness commandとして使用せず、identity・scope・revision・source phaseを検証するsemantic transitionを使用する。
- 参照元に書かれていなかったこと: semantic APIの具体的な型構成。
- 判断: New/Existingそれぞれにdiscriminated actionを定義し、Storeの単一transition primitiveがactionごとの許可sourceとCAS preconditionを検証する。
- 理由: callerが任意phaseを書けず、Retry・Link・Assume・normal write・abortの意味を型とStore invariantの両方で分離できるため。
- 代替案: lifecycleごとの多数の小メソッド。意味は満たすがJournal interfaceが肥大化するため採用しなかった。
- 影響: `SyncJournal`、`TicketSyncService`、`NewTicketFinalizer`、`TicketReconciler`がsemantic actionを使用する。
- 可逆性: 中。内部API変更だがpublic VS Code/Redmine APIは不変。
- 制約: 制約により必須。
- ユーザー確認: 不要

### D-002 generic queued mutation はpromotionせず拒否する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: generic `phase=queued` promotionを廃止し、`queued => nextIntent undefined`を維持する。
- 参照元に書かれていなかったこと: legacy generic helperへ`queued`と`nextIntent`が同時に渡された場合の応答。
- 判断: generic helperはsilent promotionも`queued + nextIntent`生成も行わず、mutationを`undefined`で拒否する。
- 理由: invariantを破らず、promotionをabort・completion・load normalizationの明示経路だけへ限定するため。
- 代替案: nextIntentを破棄してqueued化。later intentを失うため不採用。
- 影響: staleなraw lifecycle callerはfail closedする。
- 可逆性: 高。
- 制約: 制約により必須。
- ユーザー確認: 不要

### D-003 Retry preflight failure は commit_unknown outcome を返す

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: Retry preflight failureではactive Aを`commit_unknown`、Bを`nextIntent`のまま保持し、既存outcomeを大きく増やさずrecovery-requiredとして返す。
- 参照元に書かれていなかったこと: `failed_before_commit`と`commit_unknown`のどちらを選ぶか。
- 判断: New/Existingとも`commit_unknown` outcomeを返す。
- 理由: remote uncertaintyが未解決であり、通常pre-remote failureと区別してRecovery UXを維持するため。
- 代替案: `failed_before_commit`。normal abortと誤認されるため不採用。
- 影響: remote writeは0、persistent active/nextは変更なし。
- 可逆性: 高。
- 制約: 任意判断。
- ユーザー確認: 事後報告

### D-004 runtime remote_write_started はRecovery入口で正規化しない

- 種別: 技術制約
- タイミング: 実装後レビュー
- 参照元に書かれていたこと: Retry直前のCAS後だけ`remote_write_started`とし、duplicate Recovery remote writeを1以下にする。Restart時はunknownへ正規化する。
- 参照元に書かれていなかったこと: 同一processでremote call実行中のRecovery actionへの応答。
- 判断: runtimeの`remote_write_started`は変更せず`commit_unknown` outcomeを返し、Link/Assume/別Retryを開始しない。Restart load境界だけが`commit_unknown`へ正規化する。
- 理由: in-flight Retryが取得したsource ownershipをremote call完了まで保持し、Link/Assumeの割込みを防ぐため。
- 代替案: Recovery入口で即`commit_unknown`化。in-flight remote writeと別Recoveryが並行可能になるため不採用。
- 影響: persistence failureで`remote_write_started`が残った場合はrestart後に明示Recovery可能。安全側に倒れる。
- 可逆性: 高。
- 制約: 制約により必須。
- ユーザー確認: 不要

## 変更・逸脱

参照元からの機能逸脱はなし。Full suite後の最終差分レビューでD-004の競合ガードを追加したため、最終コードに対してfull suiteを再実行した。

## 妥協点と残課題

実Redmine 6.1環境がないため、実ネットワークでのtimeout/restart E2Eは未実施。deterministic dependency injectionとVS Code extension suiteで検証した。

## 検証と制約

- 実行した検証: HEAD/branch確認、Red failure再現（New/Existing payload、preflight failure、Retry/Link）、Reproduction/Invariant tests 15件、Ticket Sync subsystem 63件（レビュー前）＋追加in-flight race 1件、full VS Code suite 827 passing、`pnpm run lint`、`pnpm exec tsc --noEmit`、`pnpm run compile`、`git diff --check`、production raw lifecycle mutation検索。
- 実行できなかった検証: 実Redmine 6.1を用いるnetwork timeout/restart E2E（環境なし）。

## 結果

semantic transition boundaryへ統一し、normal abortとExplicit Retryを分離した。New/Existing Retryは`commit_unknown` active revision Aをpreflight/remote payloadへ固定し、Bを`nextIntent`のまま保持する。source-phase CASによりduplicate Retry・Retry/Link・Retry/Assumeのうち一つだけが進み、generic queued promotionとProduction raw phase mutationを撤去した。
