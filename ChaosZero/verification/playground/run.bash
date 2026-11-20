#!/usr/bin/env bash
set -euo pipefail

main() {
	local root frontend scratch backend runner status
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	frontend="$(cd "$root/../Cosmic-Signature-frontend" && pwd)"
	COSMIC_CONTRACTS_DIR="$(cd "$root/../Cosmic-Signature" && pwd)"
	export CHAOS_ZERO_ROOT="$root"
	export COSMIC_CONTRACTS_DIR AXIOM_ZERO_ROOT
	AXIOM_ZERO_ROOT="$(cd "$root/../axiomzero" && pwd)"
	if [[ "${1:-}" == --interactive || "${1:-}" == --interactive-smoke ]]; then
		if [[ $# != 1 ]]; then echo "Use run.bash --interactive without additional arguments." >&2; return 2; fi
		backend="$(bash "$root/verification/playground/backend-checkout.bash" "$(cd "$root/.." && pwd)")"
	else
		backend="$(cd "${RWCG_BACKEND_DIR:-$root/../../augur-explorer}" && pwd)"
	fi
	export RWCG_BACKEND_DIR="$backend"
	# This copy has its own build, addresses, testing wallet and database configuration.
	# No .env files, browser profiles or running developer stacks are reused.
	scratch="$(mktemp -d "${TMPDIR:-/tmp}/cosmic-v4-browser.XXXXXXXX")"
	scratch="$(cd "$scratch" && pwd -P)"
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
	if [[ "${1:-}" == --interactive-smoke ]]; then
		# These integration modules resolve against the actual staged frontend.
		(cd "$scratch" && node_modules/.bin/tsc --noEmit)
		# Reserve all seven ports together, then release for the individual servers.
		# The stack also preflights each port before deploying its fresh local node.
		read -r HARNESS_CHAIN_PORT HARNESS_DB_PORT HARNESS_API_PORT HARNESS_WEB_PORT HARNESS_CONTROL_PORT V4_CHAOS_PORT V4_AXIOM_PORT < <(
			node --input-type=module -e '
				import { createServer } from "node:net";
				const servers = await Promise.all(Array.from({length: 7}, () => new Promise((ok, fail) => {
					const server = createServer();
					server.once("error", fail).listen(0, "127.0.0.1", () => ok(server));
				})));
				console.log(servers.map(server => server.address().port).join(" "));
				servers.forEach(server => server.close());
			'
		)
		export V4_CHAOS_PORT V4_AXIOM_PORT
	fi
	export V4_PLAYGROUND_MANIFEST="$scratch/.harness/v4.json"
	HARNESS_COMPOSE_PROJECT="v4play-$(basename "$scratch" | tr '[:upper:].' '[:lower:]-')"
	export HARNESS_COMPOSE_PROJECT
	export HARNESS_CHAIN_PORT="${HARNESS_CHAIN_PORT:-18564}" HARNESS_DB_PORT="${HARNESS_DB_PORT:-55534}"
	export HARNESS_API_PORT="${HARNESS_API_PORT:-18109}" HARNESS_WEB_PORT="${HARNESS_WEB_PORT:-14670}"
	export HARNESS_CONTROL_PORT="${HARNESS_CONTROL_PORT:-18690}"
	export CI=1 HARDHAT_MODE_CODE=1 ENABLE_HARDHAT_PREPROCESSOR=false NEXT_TELEMETRY_DISABLED=1
	export HARDHAT_CONFIG="$root/verification/playground/hardhat.config.cjs"
	forge build --root "$root" src/GameFundedOutcomeMarket.sol src/V3OutcomeSource.sol src/IndependentOutcomeMarket.sol
	cd "$scratch"
	if [[ "${1:-}" == --interactive || "${1:-}" == --interactive-smoke ]]; then
		node --import tsx "$scratch/e2e/v4-playground/stack.ts" "$@" &
		runner=$!
		trap 'kill -TERM "$runner" 2>/dev/null || true' INT TERM
		status=0
		while kill -0 "$runner" 2>/dev/null; do wait "$runner" && status=0 || status=$?; done
		trap - INT TERM
		if [[ $status != 0 ]]; then return "$status"; fi
	else
		"$frontend/node_modules/.bin/tsx" e2e/v4-playground/stack.ts "$@"
	fi
	cd "$root"
	rm -rf "$scratch"
}
{ main "$@"; exit; }
