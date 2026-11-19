"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const gameRoot = path.resolve(__dirname, "../..");
const pinnedRevision = "018d0b12e1bb933e94d0d82aebf906df35335221";

// Only this private cache is populated by the runner. Local companion checkouts may
// contain the developer's changes and must never be switched to the CI revision.
function cachedCheckout() {
	const env_ = { ...process.env };
	for (const name_ of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).trim().split("\n")) {
		delete env_[name_];
	}
	function git(args_, cwd_) {
		return execFileSync("git", args_, { cwd: cwd_, env: env_, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
	}
	const parent_ = path.join(gameRoot, "cache", "v4-companions");
	const checkout_ = path.join(parent_, pinnedRevision);
	if ( ! fs.existsSync(checkout_)) {
		fs.mkdirSync(parent_, { recursive: true });
		const temp_ = fs.mkdtempSync(path.join(parent_, ".checkout-"));
		try {
			git(["init", "--quiet"], temp_);
			git(["fetch", "--quiet", "--depth=1", "https://github.com/PredictionExplorer/ChaosZero.git", pinnedRevision], temp_);
			git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], temp_);
			git(["submodule", "update", "--init", "--recursive", "--depth=1"], temp_);
			try {
				fs.renameSync(temp_, checkout_);
			} catch (errorObject_) {
				if (errorObject_.code !== "ENOTEMPTY" && errorObject_.code !== "EEXIST") {
					throw errorObject_;
				}
			}
		} finally {
			fs.rmSync(temp_, { recursive: true, force: true });
		}
	}
	if (git(["rev-parse", "HEAD"], checkout_) !== pinnedRevision) {
		throw new Error("Unexpected Chaos Zero revision in " + checkout_);
	}
	return checkout_;
}

function prepareChaosZero(pinned_ = false) {
	const explicitRoot_ = process.env.CHAOS_ZERO_ROOT;
	const localRoot_ = explicitRoot_ ? path.resolve(explicitRoot_) : path.resolve(gameRoot, "../ChaosZero");
	const useLocal_ = ! pinned_ && (explicitRoot_ || fs.existsSync(path.join(localRoot_, "foundry.toml")));
	const root_ = useLocal_ ? localRoot_ : cachedCheckout();
	if ( ! fs.existsSync(path.join(root_, "lib/openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol"))) {
		throw new Error("Initialize the Chaos Zero submodules in " + root_ + " with git submodule update --init --recursive.");
	}
	console.error("Building Chaos Zero companions in " + root_);
	execFileSync("forge", [
		"build", "--root", ".", "--out", "out", "src/V3OutcomeSource.sol", "src/GameFundedOutcomeMarket.sol",
	], {
		cwd: root_, env: { ...process.env, FOUNDRY_PROFILE: "default" }, stdio: ["ignore", 2, 2],
	});
	return root_;
}

function main() {
	console.log(prepareChaosZero(process.argv.includes("--pinned")));
}
if (require.main === module) main();
module.exports = { prepareChaosZero };
