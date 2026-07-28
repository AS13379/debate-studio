#!/bin/zsh
set -euo pipefail

VERSION="2.9.4"
SHA256="ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/native/sparkle/vendor"
ARCHIVE="$VENDOR/Sparkle-${VERSION}.tar.xz"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz"

mkdir -p "$VENDOR"
if [[ ! -f "$VENDOR/.sparkle-${VERSION}.stamp" ]]; then
  curl --fail --location --retry 3 --output "$ARCHIVE" "$URL"
  ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  [[ "$ACTUAL" == "$SHA256" ]] || { echo "Sparkle SHA-256 mismatch" >&2; exit 1; }
  tar -xJf "$ARCHIVE" -C "$VENDOR"
  rm -f "$ARCHIVE"
  print "$SHA256" > "$VENDOR/.sparkle-${VERSION}.stamp"
fi

[[ -d "$VENDOR/Sparkle.framework" ]]
[[ -x "$VENDOR/bin/sign_update" ]]
[[ -x "$VENDOR/bin/generate_appcast" ]]
echo "Sparkle ${VERSION} runtime verified."
