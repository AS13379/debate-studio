#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
zsh "$ROOT/scripts/fetch-sparkle-runtime.sh"

"$ROOT/node_modules/.bin/node-gyp" rebuild \
  --directory "$ROOT/native/sparkle" \
  --target=35.7.5 \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers

BRIDGE="$ROOT/native/sparkle/build/Release/sparkle_bridge.node"
[[ -f "$BRIDGE" ]]
file "$BRIDGE" | grep -q "arm64"
otool -L "$BRIDGE" | grep -q "@rpath/Sparkle.framework"
echo "Formal Sparkle bridge verified."
