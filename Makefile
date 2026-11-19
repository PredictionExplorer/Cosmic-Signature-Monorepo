.DEFAULT_GOAL := help
.NOTPARALLEL:
.PHONY: help setup hooks test test-repo test-v4 test-game test-site test-chaos test-axiom test-auction test-playground verify-import

help:
	@printf '%s\n' 'make setup           Install locked dependencies for all four components' \
		'make hooks           Enable the shared, component-scoped Git hooks' \
		'make test-repo       Check shared tooling, documentation links and import history' \
		'make test-game       Check the game, upgrades and auction contract invariants' \
		'make test-site       Check main site languages, lint, types and Jest coverage' \
		'make test-chaos      Run Chaos Zero contract and frontend checks' \
		'make test-axiom      Run Axiom Zero lint, type and unit checks' \
		'make test-auction    Exercise the V4 auction lifecycle in Chromium on a local chain' \
		'make test-playground Run the three-site browser rehearsal using the external indexer/API' \
		'make test-v4         Run the game upgrade suite and both local browser rehearsals' \
		'make test            Run the component validation suites in sequence' \
		'make verify-import   Verify the recorded migration snapshots in this clone'

setup:
	git submodule update --init --recursive
	cd Cosmic-Signature && npm ci
	cd Cosmic-Signature-frontend && npm ci
	cd ChaosZero && pnpm install --frozen-lockfile
	cd ChaosZero/frontend && pnpm install --frozen-lockfile
	cd axiomzero && pnpm install --frozen-lockfile

hooks:
	./scripts/install-hooks

test: test-repo test-game test-site test-chaos test-axiom

test-repo: verify-import
	python3 -m unittest discover -s scripts/tests
	python3 scripts/check_docs.py

test-v4: test-game test-auction test-playground

test-game:
	cd Cosmic-Signature && npm run test:credentials
	cd Cosmic-Signature && TERM=$${TERM:-xterm} npm run hardhat-test-quick
	cd Cosmic-Signature && npm run test:auction:fuzz

test-site:
	cd Cosmic-Signature-frontend && npm run i18n:check && npm run lint && npm run type-check && CI=true npm run test:coverage -- --maxWorkers=2

test-chaos:
	cd ChaosZero && pnpm check

test-axiom:
	cd axiomzero && pnpm lint && pnpm typecheck && pnpm test:unit

test-auction:
	cd Cosmic-Signature && HARDHAT_MODE_CODE=1 ENABLE_HARDHAT_PREPROCESSOR=false npx --no-install hardhat compile
	cd axiomzero && pnpm test:auction:local

test-playground:
	cd ChaosZero && pnpm test:v4:browser

verify-import:
	python3 scripts/verify-import.py
