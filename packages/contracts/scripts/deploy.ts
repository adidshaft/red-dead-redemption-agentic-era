import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const appTreasury = process.env.APP_TREASURY_ADDRESS ?? deployer.address;

  const factory = await ethers.getContractFactory("ArenaEconomy");
  const contract = await factory.deploy(appTreasury, deployer.address);
  await contract.waitForDeployment();

  console.log(JSON.stringify({
    address: await contract.getAddress(),
    deployer: deployer.address,
    appTreasury,
    chainId: Number(process.env.XLAYER_TESTNET_CHAIN_ID ?? "1952"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
