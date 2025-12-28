# Data Model: 編集ファイルパス固定設定

## Entities

### EditorStorageSetting

- Represents: 編集ファイル保存先ディレクトリの設定値
- Fields:
  - directoryPath (string): OSの絶対パス

### TicketEditorFile

- Represents: チケット選択時に開く編集ファイル
- Fields:
  - filePath (string): 作成されるファイルの絶対パス
  - fallbackUsed (boolean): フォールバック先を使用したか

## Relationships

- EditorStorageSetting.directoryPath -> TicketEditorFile.filePath (1:many)

## Validation Rules

- directoryPath は絶対パスであること
- directoryPath が無効な場合はフォールバックする
