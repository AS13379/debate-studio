#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
ICONSET_DIR="$ROOT_DIR/build/icon.iconset"
SOURCE="$ROOT_DIR/build/icon.svg"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
qlmanage -t -s 1024 -o "$ICONSET_DIR" "$SOURCE" >/dev/null 2>&1
mv "$ICONSET_DIR/icon.svg.png" "$ICONSET_DIR/source.png"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICONSET_DIR/source.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICONSET_DIR/source.png" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

rm "$ICONSET_DIR/source.png"
iconutil -c icns "$ICONSET_DIR" -o "$ROOT_DIR/build/icon.icns"
rm -rf "$ICONSET_DIR"
