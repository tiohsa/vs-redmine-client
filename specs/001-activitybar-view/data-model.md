# Data Model: Activity Bar専用一覧ビュー

## Entity: プロジェクト
- **Purpose**: 作業単位として一覧に表示される対象
- **Key Fields**:
  - id (識別子)
  - name (表示名)
  - hasChildren (子プロジェクト有無)
- **Relationships**:
  - 1プロジェクトは複数のチケットを持つ

## Entity: チケット
- **Purpose**: プロジェクトに属する作業項目
- **Key Fields**:
  - id (識別子)
  - subject (件名)
  - projectId (所属プロジェクト)
  - status (状態)
  - updatedAt (更新日時)
- **Relationships**:
  - 1チケットは複数のコメントを持つ

## Entity: コメント
- **Purpose**: チケットに紐づくやり取り
- **Key Fields**:
  - id (識別子)
  - ticketId (所属チケット)
  - author (投稿者)
  - createdAt (作成日時)
  - body (本文)

## Validation Rules
- 一覧表示は最大2,000件までを対象とする
- エクスプローラーと同じ階層・並びを維持する

## State Transitions
- 該当なし（本機能では状態遷移の追加なし）
