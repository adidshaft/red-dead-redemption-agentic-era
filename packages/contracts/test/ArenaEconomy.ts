import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("ArenaEconomy", () => {
  async function deployFixture() {
    const [deployer, owner, outsider, winnerTreasury, appTreasury] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ArenaEconomy", deployer);
    const contract = await factory.deploy(appTreasury.address, deployer.address);
    await contract.waitForDeployment();

    const agentId = ethers.id("agent-1");
    const secondAgentId = ethers.id("agent-2");
    await contract.connect(owner).registerAgent(agentId, winnerTreasury.address);
    await contract.connect(outsider).registerAgent(secondAgentId, outsider.address);

    return { contract, deployer, owner, outsider, winnerTreasury, appTreasury, agentId, secondAgentId };
  }

  it("uses the correct pricing bands as purchase counts grow", async () => {
    const { contract, owner, agentId } = await deployFixture();

    expect(await contract.quoteSkillPrice(agentId, 0)).to.equal(ethers.parseEther("0.001"));

    for (let i = 0; i < 4; i += 1) {
      await contract.connect(owner).purchaseSkill(agentId, 0, { value: ethers.parseEther("0.001") });
    }

    expect(await contract.quoteSkillPrice(agentId, 0)).to.equal(ethers.parseEther("0.002"));

    for (let i = 0; i < 6; i += 1) {
      await contract.connect(owner).purchaseSkill(agentId, 0, { value: ethers.parseEther("0.002") });
    }

    expect(await contract.quoteSkillPrice(agentId, 0)).to.equal(ethers.parseEther("0.004"));
  });

  it("enforces ownership checks on skill purchases and match entry", async () => {
    const { contract, outsider, agentId } = await deployFixture();

    await expect(contract.connect(outsider).purchaseSkill(agentId, 1, { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(
      contract,
      "NotAgentOwner",
    );
    await expect(contract.connect(outsider).enterMatch(agentId, { value: ethers.parseEther("0.002") })).to.be.revertedWithCustomError(
      contract,
      "NotAgentOwner",
    );
  });

  it("rejects duplicate agent registration", async () => {
    const { contract, owner, agentId, winnerTreasury } = await deployFixture();

    await expect(contract.connect(owner).registerAgent(agentId, winnerTreasury.address)).to.be.revertedWithCustomError(
      contract,
      "AgentAlreadyRegistered",
    );
  });

  it("settles the entry pool with the expected payout split", async () => {
    const { contract, deployer, owner, outsider, agentId, secondAgentId, winnerTreasury, appTreasury } = await deployFixture();

    await contract.connect(owner).enterMatch(agentId, { value: ethers.parseEther("0.002") });
    await contract.connect(outsider).enterMatch(secondAgentId, { value: ethers.parseEther("0.002") });

    const winnerTreasuryBefore = await ethers.provider.getBalance(winnerTreasury.address);
    const appTreasuryBefore = await ethers.provider.getBalance(appTreasury.address);

    const tx = await contract.connect(deployer).settleMatch(ethers.id("match-1"), agentId, ethers.id("digest-1"));
    await tx.wait();

    const winnerTreasuryAfter = await ethers.provider.getBalance(winnerTreasury.address);
    const appTreasuryAfter = await ethers.provider.getBalance(appTreasury.address);

    expect(winnerTreasuryAfter - winnerTreasuryBefore).to.equal(ethers.parseEther("0.0038"));
    expect(appTreasuryAfter - appTreasuryBefore).to.equal(ethers.parseEther("0.0002"));
  });

  it("allows only the operator to settle and rejects duplicate settlement", async () => {
    const { contract, deployer, owner, outsider, agentId, secondAgentId } = await deployFixture();

    await contract.connect(owner).enterMatch(agentId, { value: ethers.parseEther("0.002") });
    await contract.connect(outsider).enterMatch(secondAgentId, { value: ethers.parseEther("0.002") });

    await expect(contract.connect(owner).settleMatch(ethers.id("match-2"), agentId, ethers.id("digest-2"))).to.be.revertedWithCustomError(
      contract,
      "NotOperator",
    );

    await contract.connect(deployer).settleMatch(ethers.id("match-2"), agentId, ethers.id("digest-2"));

    await expect(contract.connect(deployer).settleMatch(ethers.id("match-2"), agentId, ethers.id("digest-2"))).to.be.revertedWithCustomError(
      contract,
      "MatchAlreadySettled",
    );
  });
});
