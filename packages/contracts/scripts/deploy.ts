import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import hre from "hardhat";

async function main() {
  const { ethers, network } = hre;
  const rpcUrl =
    process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
  const expectedChainId = Number(process.env.XLAYER_TESTNET_CHAIN_ID ?? "1952");
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  if (chainId !== expectedChainId) {
    throw new Error(
      `Connected chain ID ${chainId} does not match XLAYER_TESTNET_CHAIN_ID=${expectedChainId}.`,
    );
  }

  const appTreasury = process.env.APP_TREASURY_ADDRESS ?? deployer.address;

  const factory = await ethers.getContractFactory("ArenaEconomy");
  const contract = await factory.deploy(appTreasury, deployer.address);
  const deploymentTx = contract.deploymentTransaction();
  const deploymentReceipt = await deploymentTx?.wait();
  const contractAddress = await contract.getAddress();

  const deployment = {
    network: network.name,
    address: contractAddress,
    deployer: deployer.address,
    appTreasury,
    chainId,
    rpcUrl,
    explorerUrl:
      process.env.NEXT_PUBLIC_XLAYER_EXPLORER_URL ??
      "https://www.okx.com/web3/explorer/xlayer-test",
    deploymentTxHash: deploymentReceipt?.hash ?? deploymentTx?.hash ?? null,
    deploymentBlockNumber: deploymentReceipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
  };

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const deploymentsDir = path.resolve(scriptsDir, "../deployments");
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);

  await mkdir(deploymentsDir, { recursive: true });
  await writeFile(
    `${deploymentFile}`,
    `${JSON.stringify(deployment, null, 2)}\n`,
  );

  console.log(JSON.stringify(deployment, null, 2));
  console.log("");
  console.log("# Add these values to .env");
  console.log(`NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS=${contractAddress}`);
  console.log(`NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID=${chainId}`);
  console.log(`NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL=${rpcUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
