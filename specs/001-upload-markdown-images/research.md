# Research: Markdown画像リンクの自動アップロード

## Decision 1: 既存の添付アップロード経路を利用
- Decision: 画像アップロードは既存のRedmineアップロード経路とヘルパー（添付関連ユーティリティ）を再利用する。
- Rationale: 既存の認証・エラー処理・Redmine互換性が担保されているため。
- Alternatives considered: 新規のアップロード実装を追加する。

## Decision 2: Markdown画像リンクの対象範囲
- Decision: ローカルパスを指すMarkdown画像リンクのみをアップロード対象とし、外部URLは変更しない。
- Rationale: 要件で外部URLは変更しないと明記されているため。
- Alternatives considered: すべての画像リンクをアップロード対象にする。

## Decision 3: 失敗時の挙動
- Decision: 画像アップロード失敗があっても本文保存を完了し、失敗一覧と理由を提示する。
- Rationale: 作業の継続性を確保しつつ、失敗の原因が明確になる。
- Alternatives considered: 失敗時は保存を中断する。
