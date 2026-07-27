#!/bin/zsh
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: make-appcast.sh <version>" >&2
  exit 1
fi

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$ROOT/../.." && pwd)"
GENERATED_ROOT="${DST_SPARKLE_GENERATED_ROOT:-/private/tmp/debate-studio-sparkle-validation}"
OUTPUT="$GENERATED_ROOT/artifacts/$VERSION"
FEED="$GENERATED_ROOT/feed/$VERSION"
ARCHIVE="$OUTPUT/Debate-Studio-Update-Test-${VERSION}-arm64.zip"
ARCHIVE_NAME="$(basename "$ARCHIVE")"
SIGN_UPDATE="$ROOT/native/vendor/bin/sign_update"
PRIVATE_KEY_FILE="$(node "$WORKSPACE_ROOT/scripts/sparkle-private-key.mjs" --print-path)"

[[ -f "$ARCHIVE" ]] || { echo "Archive does not exist: $ARCHIVE" >&2; exit 1; }
rm -rf "$FEED"
mkdir -p "$FEED"
ln -s "$ARCHIVE" "$FEED/$ARCHIVE_NAME"

# The first validation round intentionally has no delta updates. Sparkle's
# official sign_update tool signs the exact ZIP bytes; a minimal standard
# appcast avoids generate_appcast extracting previous archives or producing
# BinaryDelta work that is irrelevant to this isolated full-update test.
if [[ -n "${SPARKLE_SIGNATURE_OUTPUT:-}" ]]; then
  SIGNATURE_OUTPUT="$SPARKLE_SIGNATURE_OUTPUT"
else
  SIGNATURE_OUTPUT="$("$SIGN_UPDATE" \
    --ed-key-file "$PRIVATE_KEY_FILE" \
    "$ARCHIVE")"
fi
SIGNATURE="$(printf '%s\n' "$SIGNATURE_OUTPUT" | sed -n 's/.*sparkle:edSignature="\([^"]*\)".*/\1/p')"
LENGTH="$(printf '%s\n' "$SIGNATURE_OUTPUT" | sed -n 's/.*length="\([0-9]*\)".*/\1/p')"

[[ -n "$SIGNATURE" ]] || { echo "sign_update did not return an EdDSA signature" >&2; exit 1; }
[[ "$LENGTH" == "$(stat -f '%z' "$ARCHIVE")" ]] || {
  echo "sign_update length does not match archive" >&2
  exit 1
}

PUB_DATE="$(LC_ALL=C date -R)"
cat > "$FEED/appcast.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Debate Studio Update Test</title>
    <link>http://127.0.0.1:27891/appcast.xml</link>
    <description>Isolated Sparkle validation feed.</description>
    <language>en</language>
    <item>
      <title>Version ${VERSION}</title>
      <pubDate>${PUB_DATE}</pubDate>
      <description><![CDATA[
        <h2>Debate Studio Update Test ${VERSION}</h2>
        <p>Isolated Sparkle validation build. Formal Debate Studio data is never read.</p>
      ]]></description>
      <sparkle:version>${VERSION}</sparkle:version>
      <sparkle:shortVersionString>${VERSION}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure
        url="http://127.0.0.1:27891/${ARCHIVE_NAME}"
        length="${LENGTH}"
        type="application/octet-stream"
        sparkle:edSignature="${SIGNATURE}" />
    </item>
  </channel>
</rss>
EOF

grep -q "sparkle:edSignature" "$FEED/appcast.xml"
echo "Signed appcast created at $FEED/appcast.xml"
