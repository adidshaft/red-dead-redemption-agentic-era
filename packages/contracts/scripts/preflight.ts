import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import hre from "hardhat";

async function main() {
  const { ethers, network } = hre;
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const rootEnvPath = path.resolve(scriptsDir, "../../../.env");
  const rootEnvPresent = existsSync(rootEnvPath);
  const rpcUrl =
    process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
  const expectedChainId = Number(process.env.XLAYER_TESTNET_CHAIN_ID ?? "1952");
  const browserChainId = Number(
    process.env.NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID ??
      process.env.XLAYER_TESTNET_CHAIN_ID ??
      "1952",
  );

  const missingCriticalEnv = [
    !process.env.ARENA_OPERATOR_PRIVATE_KEY
      ? "ARENA_OPERATOR_PRIVATE_KEY"
      : null,
  ].filter((value): value is string => Boolean(value));

  const missingOnchainOsEnv = [
    !process.env.ONCHAIN_OS_API_KEY ? "ONCHAIN_OS_API_KEY" : null,
    !process.env.ONCHAIN_OS_API_SECRET ? "ONCHAIN_OS_API_SECRET" : null,
    !process.env.ONCHAIN_OS_API_PASSPHRASE ? "ONCHAIN_OS_API_PASSPHRASE" : null,
    !process.env.ONCHAIN_OS_PROJECT_ID ? "ONCHAIN_OS_PROJECT_ID" : null,
  ].filter((value): value is string => Boolean(value));

  if (missingCriticalEnv.length > 0) {
    console.log(
      JSON.stringify(
        {
          network: network.name,
          rpcUrl,
          expectedChainId,
          browserChainId,
          rootEnvPresent,
          missingCriticalEnv,
          missingOnchainOsEnv,
          warnings: [
            !rootEnvPresent
              ? "Root .env file is missing. Copy .env.example to .env and fill it."
              : null,
            "Critical deployment env is missing; preflight stopped before any RPC calls.",
          ].filter((value): value is string => Boolean(value)),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const [operator] = await ethers.getSigners();
  if (!operator) {
    throw new Error("No operator signer is available for preflight.");
  }

  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const blockNumber = await provider.getBlockNumber();
  const operatorBalance = await provider.getBalance(operator.address);
  const appTreasury = process.env.APP_TREASURY_ADDRESS ?? operator.address;
  const contractAddress = process.env.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS ?? null;

  const warnings: string[] = [];
  if (!rootEnvPresent) {
    warnings.push("Root .env file is missing. Copy .env.example to .env.");
  }
  if (chainId !== expectedChainId) {
    warnings.push(
      `Connected chain ID ${chainId} does not match XLAYER_TESTNET_CHAIN_ID=${expectedChainId}.`,
    );
  }

  if (browserChainId !== expectedChainId) {
    warnings.push(
      `Browser chain ID ${browserChainId} does not match XLAYER_TESTNET_CHAIN_ID=${expectedChainId}.`,
    );
  }

  if (operatorBalance === 0n) {
    warnings.push(
      "Operator wallet balance is zero. Fund it before deployment.",
    );
  }

  if (!process.env.APP_TREASURY_ADDRESS) {
    warnings.push(
      "APP_TREASURY_ADDRESS is not set; the deploy script will default it to the operator wallet.",
    );
  }

  if (missingOnchainOsEnv.length > 0) {
    warnings.push(
      `OnchainOS credentials are incomplete: ${missingOnchainOsEnv.join(", ")}.`,
    );
  }

  let deployment: null | {
    address: string;
    codePresent: boolean;
    operator: string | null;
    appTreasury: string | null;
  } = null;

  if (contractAddress) {
    const code = await provider.getCode(contractAddress);
    const codePresent = code !== "0x";

    let deployedOperator: string | null = null;
    let deployedTreasury: string | null = null;
    if (codePresent) {
      const contract = await ethers.getContractAt(
        "ArenaEconomy",
        contractAddress,
      );
      deployedOperator = await contract.operator();
      deployedTreasury = await contract.appTreasury();
    } else {
      warnings.push(
        `NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS is set to ${contractAddress}, but no bytecode was found there.`,
      );
    }

    deployment = {
      address: contractAddress,
      codePresent,
      operator: deployedOperator,
      appTreasury: deployedTreasury,
    };
  } else {
    warnings.push(
      "NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS is not set yet. Deploy the contract before running the full app flow.",
    );
  }

  console.log(
    JSON.stringify(
      {
        network: network.name,
        rpcUrl,
        expectedChainId,
        browserChainId,
        rootEnvPresent,
        connectedChainId: chainId,
        blockNumber,
        operatorAddress: operator.address,
        operatorBalanceWei: operatorBalance.toString(),
        operatorBalanceOkb: ethers.formatEther(operatorBalance),
        appTreasury,
        deployment,
        missingOnchainOsEnv,
        warnings,
      },
      null,
      2,
    ),
  );

  if (warnings.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
