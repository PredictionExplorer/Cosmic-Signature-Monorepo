.DEFAULT_GOAL := help
.NOTPARALLEL:
.PHONY: help setup hooks test test-v4 test-game test-site test-chaos test-axiom test-playground verify-import

help:
	@printf '%s\n' 'make setup           Install locked dependencies for all four components' \
		'make hooks           Enable the shared, component-scoped Git hooks' \
		'make test-game       Run the four-mode contract suite, including V1 to V4 fuzzing' \
		'make test-playground Run the three-site browser rehearsal using the external indexer/API' \
		'make test-v4         Run the game upgrade suite and the three-site rehearsal' \
		'make test            Run the component validation suites in sequence' \
		'make verify-import   Verify the recorded migration snapshots in this clone'

setup:
	git submodule update --init --recursive
	cd Cosmic-Signature && npm ci
	cd cosmicgame-frontend && npm ci
	cd ChaosZero && pnpm install --frozen-lockfile
	cd ChaosZero/frontend && pnpm install --frozen-lockfile
	cd axiomzero && pnpm install --frozen-lockfile

hooks:
	./scripts/install-hooks

test: test-game test-site test-chaos test-axiom

test-v4: test-game test-playground

test-game:
	cd Cosmic-Signature && TERM=$${TERM:-xterm} npm run hardhat-test-quick

test-site:
	cd cosmicgame-frontend && npm run i18n:check && npm run lint && npm run type-check && CI=true npm test -- --maxWorkers=2

test-chaos:
	cd ChaosZero && pnpm check

test-axiom:
	cd axiomzero && pnpm lint && pnpm typecheck && pnpm test:unit

test-playground:
	cd ChaosZero && pnpm test:v4:browser

verify-import:
	python3 scripts/verify-import.py
