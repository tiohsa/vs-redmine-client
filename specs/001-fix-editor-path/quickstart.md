# Quickstart: 編集ファイルパス固定設定

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

1. 設定で編集ファイル保存先ディレクトリを絶対パスで指定する
2. チケットを選択して編集ファイルが指定パスに作成されることを確認する
3. 設定を未指定に戻して従来の保存場所に作成されることを確認する
4. 不正なパスを指定した場合にエラー通知とフォールバックが起きることを確認する
