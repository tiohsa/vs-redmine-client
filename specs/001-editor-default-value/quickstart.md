# Quickstart: エディタ初期値設定

## Goal

設定画面で初期値を設定し、新規登録エディタで反映されることを確認する。

## Steps

1. 拡張機能を開発モードで起動する。
2. 設定画面で新規登録エディタの初期値を設定する。
3. 新規登録エディタを開き、初期値が反映されていることを確認する。
4. 初期値を変更し、再度新規登録エディタで反映を確認する。
5. 初期値をリセットし、該当項目が空欄になることを確認する。

## Validation Notes

- Subject/Tracker/Priority/Status は1行で入力する。
- due_date を入力する場合は YYYY-MM-DD 形式にする。

## Tests

- `npm test`
- `npm run lint`
