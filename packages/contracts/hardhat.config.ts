import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: "../../.env" });

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
    xlayerTestnet: {
      url:
        process.env.XLAYER_TESTNET_RPC_URL ??
        "https://testrpc.xlayer.tech/terigon",
      chainId: Number(process.env.XLAYER_TESTNET_CHAIN_ID ?? "1952"),
      accounts: process.env.ARENA_OPERATOR_PRIVATE_KEY
        ? [process.env.ARENA_OPERATOR_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
