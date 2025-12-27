# Quickstart: childrenメタデータによる子チケット自動登録

## Prerequisites

- Node.js
- pnpm

## Install

```bash
pnpm install
```

## Build

```bash
pnpm run compile
```

## Test

```bash
npm test
npm run lint
```

## Children Metadata Example

```yaml
issue:
  tracker:   Task
  priority:  Normal
  status:    In Progress
  due_date:  2025-12-31
  children:
    - Child task 1
    - Child task 2
```
