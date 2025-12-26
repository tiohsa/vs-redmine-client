#!/usr/bin/env bash
set -euo pipefail

export ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_NO_SANDBOX=1
export VSCODE_TEST_ELECTRON_ARGS="--no-sandbox --disable-setuid-sandbox"

pnpm run compile-tests
pnpm run compile
pnpm run lint
pnpm exec vscode-test
