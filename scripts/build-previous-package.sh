#!/usr/bin/env bash
# Build the package the upgrade E2E starts from (#47), into <out-dir>.
#
#   scripts/build-previous-package.sh <out-dir> [<ref>]
#
# The previous package is the newest release tag (v*) that is an ancestor of HEAD and not HEAD
# itself; while no earlier release exists, it is the first parent of HEAD (the previous state of
# main). Pass <ref> to choose another. The ref is built from source in a throwaway worktree with the
# same build:release the verify job uses; it needs the full history (fetch-depth: 0).
set -euo pipefail
out=${1:?usage: scripts/build-previous-package.sh <out-dir> [<ref>]}
cd "$(git rev-parse --show-toplevel)"
ref=${2:-}
if [ -z "$ref" ]; then
  ref=$(git tag --merged HEAD --no-contains HEAD --sort=-creatordate -l 'v*' | head -n 1)
  [ -n "$ref" ] || ref=HEAD^
fi
sha=$(git rev-parse --verify "$ref^{commit}")
echo "previous package: $ref ($sha)"
tree=$(mktemp -d "${TMPDIR:-/tmp}/cardybara-previous-XXXXXX")
trap 'git worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"' EXIT
git worktree add --detach "$tree" "$sha" >/dev/null
(cd "$tree" && npm ci --no-audit --no-fund --loglevel=error && npm run build:release >/dev/null)
rm -rf "$out" && mkdir -p "$out"
cp "$tree"/release/*.zip "$tree"/release/SHA256SUMS "$out"/
ls "$out"
