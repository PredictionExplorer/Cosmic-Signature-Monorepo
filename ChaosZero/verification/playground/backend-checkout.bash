#!/usr/bin/env bash
# Print an isolated, pinned backend checkout; existing developer worktrees keep their branch.
set -euo pipefail
repo="$1"
lock="$repo/Cosmic-Signature-frontend/harness.lock.json"
ref="$(node -p 'require(process.argv[1]).backend.ref' "$lock")"
repository="$(node -p 'require(process.argv[1]).backend.repository' "$lock")"
cache="$repo/.local/v4-playground/backend-$ref"

# Ignored build artifacts are fine; untracked Go sources could change the binary.
matches_pin() {
  [[ "$(git -C "$1" rev-parse HEAD 2>/dev/null)" == "$ref" ]] &&
    [[ -z "$(git -C "$1" status --porcelain)" ]]
}
if [[ -n "${RWCG_BACKEND_DIR:-}" ]]; then
  cd "$RWCG_BACKEND_DIR"
  if ! matches_pin .; then
    echo "RWCG_BACKEND_DIR must be a clean checkout of $repository commit $ref. Unset it to use the playground cache." >&2
    exit 1
  fi
  pwd -P
  exit
fi
sibling="$repo/../augur-explorer"
if matches_pin "$sibling"; then
  (cd "$sibling" && pwd -P)
  exit
fi
if [[ ! -d "$cache" ]]; then
  mkdir -p "$(dirname "$cache")"
  dir="$(mktemp -d "$(dirname "$cache")/backend-download.XXXXXXXX")"
  trap 'rm -rf "$dir"' EXIT
  git -C "$dir" init -q
  if git -C "$sibling" cat-file -e "$ref^{commit}" 2>/dev/null; then
    git -C "$dir" fetch -q --depth=1 "$sibling" "$ref"
  else
    git -C "$dir" fetch -q --depth=1 "https://github.com/$repository.git" "$ref"
  fi
  git -C "$dir" checkout --detach -q "$ref"
  # Atomic promotion also tolerates another launcher finishing the same checkout.
  node -e 'const fs = require("node:fs"); try { fs.renameSync(process.argv[1],process.argv[2]); } catch (e) { if (!["EEXIST","ENOTEMPTY"].includes(e.code)) throw e; }' "$dir" "$cache"
fi
if ! matches_pin "$cache"; then
  echo "The local playground backend cache has been modified: $cache" >&2
  exit 1
fi
echo "$cache"
