.DEFAULT_GOAL := help
BOTS ?= 0
WALLET ?= 1
export BOTS WALLET BY
.NOTPARALLEL:
.PHONY: help setup hooks play-setup play play-wallet play-bots play-advance play-status play-stop test-play test test-repo test-v4 test-game test-site test-chaos test-axiom test-auction test-playground verify-import

help:
	@printf '%s\n' 'make setup           Install locked dependencies for all four components' \
		'make play-setup      Install locked dependencies and the wallet browser' \
		'make play            Start a local V4 session (BOTS=0..3)' \
		'make play-wallet     Open all three sites in a funded wallet window (WALLET=1..3)' \
		'make play-status     Show the running session and bot activity' \
		'make play-bots       Set the number of active bots (BOTS=0..3)' \
		'make play-advance    Advance the local chain clock (BY=seconds)' \
		'make play-stop       Stop the session and dispose of its chain and database' \
		'make test-play       Rehearse the interactive wallets, bots and time controls' \
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

play-setup: setup
	cd Cosmic-Signature-frontend && ./node_modules/.bin/playwright install chromium

play:
	V4_BOT_COUNT="$$BOTS" bash ChaosZero/verification/playground/run.bash --interactive

play-wallet:
	node ChaosZero/verification/playground/human-wallet.mjs "$$WALLET"

play-bots:
	node ChaosZero/verification/playground/control.mjs bots "$$BOTS"

play-advance:
	node ChaosZero/verification/playground/control.mjs advance "$$BY"

play-status:
	node ChaosZero/verification/playground/control.mjs status

play-stop:
	node ChaosZero/verification/playground/control.mjs stop

test-play:
	bash ChaosZero/verification/playground/run.bash --interactive-smoke

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
