# Durable effect 復元ポリシーの責務分離

日付: 2026-08-13
ステータス: 実装済み
プロジェクトルート: `/home/glorydays/projects/src/ts/vs-redmine-client`

## 依頼内容

プロジェクト全体のアーキテクチャを確認し、外部挙動を変えずに保守性を改善する。既存の同期ライフサイクル修正と未コミット変更を保持し、小さな単位でリファクタリングする。

## 背景

同期機能は `src/app/syncEngine.ts` を共通入口、`src/app/ticketSync/ticketSyncService.ts` をチケット同期のオーケストレーター、`src/views/offlineSyncStore.ts` を永続キュー兼ライフサイクル journal として構成している。durable effect の型と状態遷移は `src/app/syncEffects.ts` にあるが、再起動時の effect 復元ルールは `offlineSyncStore.ts` に埋め込まれている。

## 調査結果

- CodeGraph は 617 ファイル、40,046 ノード、69,895 エッジを正常に索引化している。
- `offlineSyncStore.ts` は約1,960行・100超のシンボルを持ち、永続化、serialization、queue mutation、operation lifecycle、effect restoration を担当する Large Module になっている。
- `syncEffects.ts` は durable effect の型と CAS 状態遷移を持つ純粋なドメインモジュールだが、restart 時の `started -> commit_unknown` と不確定状態の分類は store 側にある。
- 未コミット修正は新規チケット／コメントの不確定 effect を再起動後も `commit_unknown` に保ち、重複 POST を防ぐ。これは維持すべき characterization behavior である。
- 変更前の `pnpm run test:unsafe` は VS Code 1.133.0 で 882 tests passing。compile、compile-tests、lint も成功した。

## 判断

- durable effect 自体の復元・分類ポリシーを `src/app/syncEffects.ts` に移し、`offlineSyncStore.ts` は永続データから operation を組み立てる責務に限定する。
- operation phase や legacy payload から effect ledger を合成する処理は永続形式に依存するため、今回は store に残す。巨大ファイルの全面分割は振る舞い変更リスクが大きく、段階的リファクタリングの原則に反する。
- 公開関数は純粋関数とし、既存の state machine test に restart restoration と不確定状態分類の characterization test を追加する。

## 実装計画

1. `syncEffects.ts` に effect の restart restoration と不確定状態判定を抽出する。
2. `offlineSyncStore.ts` のローカル実装を抽出関数の利用へ置き換える。
3. `durableSyncEffect.test.ts` に全対象状態と defensive copy の回帰テストを追加する。
4. compile、lint、全 Extension Host tests、diff check を実行する。

## リスクと対策

- リスク: `target` の参照共有により、復元後の mutation が保存スナップショットを破壊する。
  対策: 抽出関数が effect と `target` を複製することをテストする。
- リスク: 不確定状態集合の変更で queued operation が誤って再送可能になる。
  対策: `started`、`commit_unknown`、`compensation_started`、`compensation_unknown` と確定状態を表形式でテストする。
- リスク: 既存の未コミット修正を上書きする。
  対策: 同じ挙動を抽出関数へ移すだけに留め、既存の operation-level tests を全件実行する。

## 検証方法

- `pnpm run compile-tests`
- `pnpm run compile`
- `pnpm run lint`
- `pnpm run test:unsafe`
- `git diff --check`
- `git status --short`

## 結果

`restoreDurableSyncEffect` と `hasUncertainDurableSyncEffect` を `src/app/syncEffects.ts` に抽出し、`offlineSyncStore.ts` は永続 operation の組み立て時にこれらを利用する構成へ変更した。restart 時の `started -> commit_unknown`、不確定状態集合、`target` の defensive copy を純粋関数のテストで固定した。

検証結果: `pnpm run compile-tests`、`pnpm run compile`、`pnpm run lint`、`pnpm run test:unsafe`、`git diff --check` は成功。VS Code 1.133.0 Extension Host で 885 tests passing（変更前 882 tests passing、追加3件）。既存の `.eslintignore` 廃止警告と環境の file watcher `ENOSPC` 警告は出たが、テスト結果への影響はなかった。
