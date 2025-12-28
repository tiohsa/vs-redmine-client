# Quickstart: チケット一覧の子チケット追加アイコン

## Prerequisites

- Node.js (project standard)
- npm

## Install

```bash
npm install
```

## Test

```bash
npm test
npm run lint
```

## Validation

1. チケット一覧で子チケット追加アイコンをクリックする
2. 新規チケット編集画面が開き、メタデータに parent が設定されている
3. 作成権限がない場合はアイコンが表示されない
4. 親チケット番号が取得できない場合はエラー通知で中断する
