#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-v14.0.0}"
TAG="$VERSION"
ARCHIVE_URL="https://github.com/semanticarts/gist/archive/refs/tags/${TAG}.tar.gz"
TARGET_DIR="$ROOT_DIR/upstream/gist/${VERSION#v}"
TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TMP_DIR/gist-${VERSION}.tar.gz"

mkdir -p "$TARGET_DIR/ontologies"
curl -L "$ARCHIVE_URL" -o "$ARCHIVE_PATH"
tar -xzf "$ARCHIVE_PATH" -C "$TARGET_DIR" --strip-components=2 \
  "gist-${VERSION#v}/ontologies/gistCore.ttl" \
  "gist-${VERSION#v}/ontologies/gistMediaTypes.ttl" \
  "gist-${VERSION#v}/ontologies/gistPrefixDeclarations.ttl" \
  "gist-${VERSION#v}/ontologies/gistValidationAnnotations.ttl"

cat > "$TARGET_DIR/source-artifacts.json" <<EOF
{
  "repoUrl": "https://github.com/semanticarts/gist",
  "tag": "${TAG}",
  "archiveUrl": "${ARCHIVE_URL}",
  "files": [
    "ontologies/gistCore.ttl",
    "ontologies/gistMediaTypes.ttl",
    "ontologies/gistPrefixDeclarations.ttl",
    "ontologies/gistValidationAnnotations.ttl"
  ]
}
EOF

echo "Staged upstream gist source into $TARGET_DIR"
