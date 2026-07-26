#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/fetch-sparkle.sh"

npm install --ignore-scripts --no-audit --no-fund
npx node-gyp rebuild \
  --directory "$ROOT/native" \
  --target=35.7.5 \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers

otool -L "$ROOT/native/build/Release/sparkle_bridge.node"
