# Data Model: コメント画像アップロード

## Entities

### コメント (Comment)
- **id**: コメント識別子
- **ticketId**: チケット識別子
- **body**: コメント本文（Markdownを含む）
- **authorId**: 作成者識別子
- **createdAt / updatedAt**: 作成・更新日時
- **imageLinks**: 本文から検出された画像リンクの一覧

### 画像リンク (ImageLink)
- **path**: 画像パス（ローカルまたは外部）
- **isExternal**: 外部リンク判定
- **resolvedPath**: ローカルパス解決結果（外部の場合は未設定）

### 画像アップロード結果 (ImageUploadResult)
- **token**: アップロードトークン
- **filename**: アップロードされたファイル名
- **contentType**: 画像のコンテンツ種別
- **status**: 成功/失敗
- **reason**: 失敗理由（失敗時のみ）

## Relationships

- コメント 1件に対して 0..n 件の画像リンクが紐づく
- コメント 1件に対して 0..n 件の画像アップロード結果が紐づく

## Validation Rules

- 画像リンクはチケット編集時と同等の基準で判定する（拡張子・形式・サイズ）
- 外部リンクはアップロード対象外
- 画像アップロードが1件でも失敗した場合、コメント保存は失敗扱い

## State Transitions

- 下書き → 保存試行 → 成功（コメント保存完了）
- 下書き → 保存試行 → 失敗（画像アップロード失敗を含む）
