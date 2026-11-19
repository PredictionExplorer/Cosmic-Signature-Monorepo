#!/usr/bin/env bash
set -euo pipefail

main() {
	local root frontend scratch
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	frontend="$(cd "$root/../Cosmic-Signature-frontend" && pwd)"
	export COSMIC_CONTRACTS_DIR="$(cd "$root/../Cosmic-Signature" && pwd)"
	export CHAOS_ZERO_ROOT="$root"
	export AXIOM_ZERO_ROOT="$(cd "$root/../axiomzero" && pwd)"
	export RWCG_BACKEND_DIR="$(cd "${RWCG_BACKEND_DIR:-$root/../../augur-explorer}" && pwd)"
	# This copy has its own build, addresses, testing wallet and database configuration.
	# No .env files, browser profiles or running developer stacks are reused.
	scratch="$(mktemp -d "${TMPDIR:-/tmp}/cosmic-v4-browser.XXXXXXXX")"
	echo "V4 browser workspace: $scratch"
	node "$root/verification/playground/stage-frontend.mjs" "$frontend" "$scratch"
	if [[ "$(uname -s)" == Darwin ]]; then
		cp -cR "$frontend/node_modules" "$scratch/node_modules"
	else
		mkdir -p "$scratch/node_modules"
		cp -al "$frontend/node_modules/." "$scratch/node_modules" 2>/dev/null ||
			cp -a --reflink=auto "$frontend/node_modules/." "$scratch/node_modules"
	fi
	mkdir -p "$scratch/e2e/v4-playground" "$scratch/.harness/logs"
	cp "$root"/verification/playground/*.ts "$root/verification/playground/site.mjs" "$scratch/e2e/v4-playground/"
	export V4_PLAYGROUND_MANIFEST="$scratch/.harness/v4.json"
	export HARNESS_COMPOSE_PROJECT="v4play-$(basename "$scratch" | tr '[:upper:].' '[:lower:]-')"
	export HARNESS_CHAIN_PORT="${HARNESS_CHAIN_PORT:-18564}" HARNESS_DB_PORT="${HARNESS_DB_PORT:-55534}"
	export HARNESS_API_PORT="${HARNESS_API_PORT:-18109}" HARNESS_WEB_PORT="${HARNESS_WEB_PORT:-14670}"
	export HARNESS_CONTROL_PORT="${HARNESS_CONTROL_PORT:-18690}"
	export CI=1 HARDHAT_MODE_CODE=1 ENABLE_HARDHAT_PREPROCESSOR=false NEXT_TELEMETRY_DISABLED=1
	export HARDHAT_CONFIG="$root/verification/playground/hardhat.config.cjs"
	forge build --root "$root" src/GameFundedOutcomeMarket.sol src/V3OutcomeSource.sol src/IndependentOutcomeMarket.sol
	cd "$scratch"
	"$frontend/node_modules/.bin/tsx" e2e/v4-playground/stack.ts "$@"
	cd "$root"
	rm -rf "$scratch"
}
main "$@"
