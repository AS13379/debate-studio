#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
ICONSET_DIR="$ROOT_DIR/build/icon.iconset"
SOURCE="$ROOT_DIR/build/icon.png"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
"$ROOT_DIR/node_modules/.bin/electron" "$ROOT_DIR/scripts/render-macos-icon.cjs"
cp "$SOURCE" "$ICONSET_DIR/source.png"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICONSET_DIR/source.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICONSET_DIR/source.png" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

rm "$ICONSET_DIR/source.png"
iconutil -c icns "$ICONSET_DIR" -o "$ROOT_DIR/build/icon.icns"
rm -rf "$ICONSET_DIR"
