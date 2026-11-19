"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// The game and its market are versioned and tested in one working tree.
function prepareChaosZero() {
	const root_ = path.resolve(__dirname, "../../../ChaosZero");
	if ( ! fs.existsSync(path.join(root_, "lib/openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol"))) {
		throw new Error("Initialize the monorepo submodules with git submodule update --init --recursive.");
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
	if (process.argv.length !== 2) throw new Error("Usage: node test/runners/prepare-chaos-zero.js");
	console.log(prepareChaosZero());
}
if (require.main === module) main();
module.exports = { prepareChaosZero };
