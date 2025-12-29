# Data Model: Comment Save Rename

## Entities

### Comment

- **Purpose**: Redmineチケットに紐づくコメント本体。
- **Key Fields**:
  - `projectId`: コメントが属するプロジェクト識別子
  - `ticketId`: コメントが属するチケット識別子
  - `commentId`: コメント識別子（新規作成後に確定）
  - `body`: コメント本文
- **Relationships**:
  - Comment belongs to Ticket
  - Ticket belongs to Project

### CommentEditorSession

- **Purpose**: コメント追加/更新を行うエディタのセッション状態。
- **Key Fields**:
  - `mode`: `add` | `update`
  - `editorUri`: 対象エディタ識別子
  - `fileName`: 現在のエディタファイル名
  - `targetCommentId`: 更新対象コメント識別子（update時のみ）
- **State Transitions**:
  - `add` → `update`: 新規保存成功後に1回だけ遷移
  - `add` (維持): 保存失敗またはコメント識別子取得失敗時

### CommentEditorFilename

- **Purpose**: エディタ保存に使用する一意のファイル名。
- **Key Fields**:
  - `projectId`
  - `ticketId`
  - `commentId`
  - `typeLabel`: 固定値 `comment`
- **Validation Rules**:
  - 新規コメント保存後に1回のみ更新モードへ切り替える（ファイル名は変更しない）
  - 以降の保存では同一コメントの更新として固定
