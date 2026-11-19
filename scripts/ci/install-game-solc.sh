#!/usr/bin/env bash
# Install the native compiler selected by Cosmic-Signature/hardhat.config.js on Linux x64.
set -euo pipefail

download=$(mktemp)
trap 'rm -f -- "$download"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  'https://raw.githubusercontent.com/argotorg/solc-bin/68447de66b15599f2e23af0051ab2080053746e4/linux-amd64/solc-linux-amd64-v0.8.38+commit.1835d247' \
  --output "$download"
echo "65c3180a336eabb6bdc4bbd49cc405aeb233976964ae6c11fba2a6c8be8f3243  $download" | sha256sum --check --strict
compiler="$HOME/.solc-select/artifacts/solc-0.8.38/solc-0.8.38"
install -D -m 755 "$download" "$compiler"
"$compiler" --version
