# Research: チケット一覧の子チケット追加アイコン

## Decision 1: アイコン表示条件

- Decision: チケット作成権限がない場合はアイコンを非表示にする
- Rationale: 権限のない操作導線を排除して混乱を防ぐ
- Alternatives considered: 無効表示、クリック時エラー

## Decision 2: 親チケットのプロジェクト

- Decision: 親チケットと同じプロジェクトで子チケットを作成する
- Rationale: 期待される親子関係を保ち、誤ったプロジェクト作成を避ける
- Alternatives considered: 現在選択中のプロジェクト、未設定

## Decision 3: アイコンクリック時の挙動

- Decision: 新規チケット編集画面を開いて入力・保存する
- Rationale: 誤作成を防ぎ、既存の作成フローと整合する
- Alternatives considered: 即時作成、確認ダイアログ

## Decision 4: メタデータ parent の形式

- Decision: 数値IDのみ（例: parent: 123）
- Rationale: 既存のID形式と整合し、解析を単純化する
- Alternatives considered: #付き文字列、数値文字列

## Decision 5: 親チケット番号が取得できない場合

- Decision: エラーメッセージを表示して中断する
- Rationale: 例外的な状態を明示し、誤作成を防ぐ
- Alternatives considered: 親なしで作成、無視
