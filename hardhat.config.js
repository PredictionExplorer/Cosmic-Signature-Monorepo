require('hardhat-abi-exporter');
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-tracer");

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 20000,
      },
    },
  },
  mocha: {
    timeout: 600000
  },
  abiExporter: {
    path: './abi',
    clear: true,
    flat: true,
    only: ['CharityWalle', 'CosmicDao', 'CosmicGame', 'CosmicSignature', 'CosmicToken', 'RaffleWallet', 'RandomWalkNFT'],
    spacing: 2,
    pretty: true,
  },
  networks: {
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/REDACTED_RPC_CREDENTIAL`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    arbigoerli: {
      url: `https://goerli-rollup.arbitrum.io/rpc`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrum: {
      url: `https://arb1.arbitrum.io/rpc`,
      accounts: process.env.MAINNET_PRIVATE_KEY !== undefined ? [process.env.MAINNET_PRIVATE_KEY] : [],
    },

  },
  etherscan: {
    apiKey: process.env.API_KEY,
  }
};
