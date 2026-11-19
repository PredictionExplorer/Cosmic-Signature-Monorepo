"use strict";

const path = require("node:path");
const config = require(path.join(process.env.COSMIC_CONTRACTS_DIR, "hardhat.config.js"));

config.paths.root = process.env.COSMIC_CONTRACTS_DIR;
config.networks.hardhat.loggingEnabled = false;
config.networks.hardhat.initialDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
config.networks.hardhat_on_localhost = {
  ...config.networks.hardhat_on_localhost,
  url: "http://127.0.0.1:" + process.env.HARNESS_CHAIN_PORT,
  gas: 30_000_000,
  timeout: 60_000,
};
module.exports = config;
