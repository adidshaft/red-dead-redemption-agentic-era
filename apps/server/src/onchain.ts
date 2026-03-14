import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";

import {
  arenaEconomyAbi,
  matchEntryFeeWei,
  mapSkillToId,
  toExplorerTxUrl,
  xLayerTestnet,
  type OnchainReceipt,
  type SkillKey,
} from "@rdr/shared";

import { config } from "./config.js";
import { createOkxSignature, encryptSecret } from "./crypto.js";

export function agentIdToBytes32(agentId: string) {
  return keccak256(stringToHex(agentId)) as Hex;
}

export function matchIdToBytes32(matchId: string) {
  return keccak256(stringToHex(matchId)) as Hex;
}

function normalizePrivateKey(privateKey?: string | null): Hex | null {
  if (!privateKey) {
    return null;
  }

  const trimmed = privateKey.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return null;
  }

  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

export class OnchainOsClient {
  async createTrackedWalletAccount(address: Address) {
    if (
      !config.ONCHAIN_OS_API_KEY ||
      !config.ONCHAIN_OS_API_SECRET ||
      !config.ONCHAIN_OS_API_PASSPHRASE ||
      !config.ONCHAIN_OS_PROJECT_ID
    ) {
      return null;
    }

    const requestPath = "/api/v5/wallet/account/create-wallet-account";
    const body = JSON.stringify({
      addresses: [
        {
          chainIndex: String(config.XLAYER_TESTNET_CHAIN_ID),
          address,
        },
      ],
    });

    const timestamp = new Date().toISOString();
    const signature = createOkxSignature({
      secret: config.ONCHAIN_OS_API_SECRET,
      timestamp,
      method: "POST",
      requestPath,
      body,
    });

    const response = await fetch(
      `${config.ONCHAIN_OS_WALLET_BASE_URL}${requestPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": config.ONCHAIN_OS_API_KEY,
          "OK-ACCESS-PASSPHRASE": config.ONCHAIN_OS_API_PASSPHRASE,
          "OK-ACCESS-PROJECT": config.ONCHAIN_OS_PROJECT_ID,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
        },
        body,
      },
    );

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      data?: Array<{ accountId?: string }>;
    };
    return json.data?.[0]?.accountId ?? null;
  }

  async getSupportedPayments() {
    const response = await fetch(
      `${config.OKX_PAYMENTS_BASE_URL}/api/v6/payments/supported`,
    );
    if (!response.ok) {
      return null;
    }
    return response.json();
  }

  async verifyPayment(
    chainIndex: string,
    paymentPayload: Record<string, unknown>,
  ) {
    const response = await fetch(
      `${config.OKX_PAYMENTS_BASE_URL}/api/v6/payments/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          x402Version: "1",
          chainIndex,
          paymentPayload,
        }),
      },
    );

    return response.json();
  }

  async settlePayment(
    chainIndex: string,
    paymentPayload: Record<string, unknown>,
  ) {
    const response = await fetch(
      `${config.OKX_PAYMENTS_BASE_URL}/api/v6/payments/settle`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          x402Version: "1",
          chainIndex,
          paymentPayload,
        }),
      },
    );

    return response.json();
  }
}

export class AgentWalletFactory {
  constructor(private readonly onchainOsClient: OnchainOsClient) {}

  async create() {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletAccountId =
      await this.onchainOsClient.createTrackedWalletAccount(account.address);

    return {
      address: account.address,
      walletAccountId,
      encryptedPrivateKey: encryptSecret(
        privateKey,
        config.WALLET_ENCRYPTION_SECRET,
      ),
    };
  }
}

export class XLayerChainService {
  private readonly publicClient = createPublicClient({
    chain: {
      id: config.XLAYER_TESTNET_CHAIN_ID,
      name: xLayerTestnet.name,
      nativeCurrency: xLayerTestnet.nativeCurrency,
      rpcUrls: {
        default: {
          http: [config.XLAYER_TESTNET_RPC_URL],
        },
      },
    },
    transport: http(config.XLAYER_TESTNET_RPC_URL),
  });

  private readonly walletClient = normalizePrivateKey(
    config.ARENA_OPERATOR_PRIVATE_KEY,
  )
    ? createWalletClient({
        account: privateKeyToAccount(
          normalizePrivateKey(config.ARENA_OPERATOR_PRIVATE_KEY)!,
        ),
        chain: {
          id: config.XLAYER_TESTNET_CHAIN_ID,
          name: xLayerTestnet.name,
          nativeCurrency: xLayerTestnet.nativeCurrency,
          rpcUrls: {
            default: {
              http: [config.XLAYER_TESTNET_RPC_URL],
            },
          },
        },
        transport: http(config.XLAYER_TESTNET_RPC_URL),
      })
    : null;

  isOperatorReady() {
    return Boolean(
      this.walletClient && config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS,
    );
  }

  private getContractAddress() {
    if (!config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS) {
      return null;
    }

    return getAddress(config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS);
  }

  async settleMatch(
    matchId: string,
    winnerAgentId: string,
    combatDigest: Hex,
  ): Promise<OnchainReceipt | null> {
    const contractAddress = this.getContractAddress();
    if (!this.walletClient || !contractAddress) {
      return null;
    }

    const hash = await this.walletClient.writeContract({
      address: contractAddress,
      abi: arenaEconomyAbi,
      functionName: "settleMatch",
      args: [
        matchIdToBytes32(matchId),
        agentIdToBytes32(winnerAgentId),
        combatDigest,
      ],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    return {
      txHash: hash,
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      status: "confirmed",
      purpose: "match_settlement",
      matchId,
      agentId: winnerAgentId,
      explorerUrl: toExplorerTxUrl(
        hash,
        config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
      ),
      createdAt: new Date().toISOString(),
    };
  }

  async lockMatch(matchId: string) {
    const contractAddress = this.getContractAddress();
    if (!this.walletClient || !contractAddress) {
      return null;
    }

    const hash = await this.walletClient.writeContract({
      address: contractAddress,
      abi: arenaEconomyAbi,
      functionName: "lockMatch",
      args: [matchIdToBytes32(matchId)],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async ensureManagedAgentInMatch(
    matchId: string,
    agentId: string,
    treasuryAddress?: Address,
  ) {
    const contractAddress = this.getContractAddress();
    if (!this.walletClient || !contractAddress) {
      return null;
    }

    const agentKey = agentIdToBytes32(agentId);
    const matchKey = matchIdToBytes32(matchId);
    const treasury = getAddress(
      treasuryAddress ??
        config.APP_TREASURY_ADDRESS ??
        this.walletClient.account.address,
    );
    const existingAgent = await this.publicClient.readContract({
      address: contractAddress,
      abi: arenaEconomyAbi,
      functionName: "agents",
      args: [agentKey],
    });

    if (!existingAgent[2]) {
      const registrationHash = await this.walletClient.writeContract({
        address: contractAddress,
        abi: arenaEconomyAbi,
        functionName: "registerAgent",
        args: [agentKey, treasury],
      });
      await this.publicClient.waitForTransactionReceipt({
        hash: registrationHash,
      });
    }

    const alreadyEntered = await this.publicClient.readContract({
      address: contractAddress,
      abi: arenaEconomyAbi,
      functionName: "hasEnteredMatch",
      args: [matchKey, agentKey],
    });

    if (alreadyEntered) {
      return null;
    }

    const hash = await this.walletClient.writeContract({
      address: contractAddress,
      abi: arenaEconomyAbi,
      functionName: "enterMatch",
      args: [matchKey, agentKey],
      value: matchEntryFeeWei,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    return {
      txHash: hash,
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      status: "confirmed",
      purpose: "match_entry",
      agentId,
      matchId,
      explorerUrl: toExplorerTxUrl(
        hash,
        config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
      ),
      createdAt: new Date().toISOString(),
    } satisfies OnchainReceipt;
  }

  async verifySkillPurchaseTx(
    txHash: string,
    agentId: string,
    skill: SkillKey,
  ) {
    const contractAddress = this.getContractAddress();
    if (!contractAddress) {
      return null;
    }

    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash as Hex,
    });

    const matchesEvent = receipt.logs.some((log) => {
      if (!log.address || !isAddressEqual(log.address, contractAddress)) {
        return false;
      }

      try {
        const decoded = decodeEventLog({
          abi: arenaEconomyAbi,
          data: log.data,
          topics: log.topics,
        });

        return (
          decoded.eventName === "SkillPurchased" &&
          decoded.args.agentId === agentIdToBytes32(agentId) &&
          Number(decoded.args.skillId) === mapSkillToId(skill)
        );
      } catch {
        return false;
      }
    });

    if (!matchesEvent) {
      return null;
    }

    return {
      txHash,
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      status: receipt.status === "success" ? "confirmed" : "failed",
      purpose: "skill_purchase",
      agentId,
      explorerUrl: toExplorerTxUrl(
        txHash,
        config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
      ),
      createdAt: new Date().toISOString(),
    } satisfies OnchainReceipt;
  }

  async verifyRegistrationTx(
    txHash: string,
    agentId: string,
    treasury: string,
  ) {
    const contractAddress = this.getContractAddress();
    if (!contractAddress) {
      return null;
    }

    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash as Hex,
    });

    const matchesEvent = receipt.logs.some((log) => {
      if (!log.address || !isAddressEqual(log.address, contractAddress)) {
        return false;
      }

      try {
        const decoded = decodeEventLog({
          abi: arenaEconomyAbi,
          data: log.data,
          topics: log.topics,
        });

        return (
          decoded.eventName === "AgentRegistered" &&
          decoded.args.agentId === agentIdToBytes32(agentId) &&
          isAddressEqual(decoded.args.treasury, getAddress(treasury))
        );
      } catch {
        return false;
      }
    });

    if (!matchesEvent) {
      return null;
    }

    return {
      txHash,
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      status: receipt.status === "success" ? "confirmed" : "failed",
      purpose: "agent_registration",
      agentId,
      explorerUrl: toExplorerTxUrl(
        txHash,
        config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
      ),
      createdAt: new Date().toISOString(),
    } satisfies OnchainReceipt;
  }

  async verifyMatchEntryTx(txHash: string, matchId: string, agentId: string) {
    const contractAddress = this.getContractAddress();
    if (!contractAddress) {
      return null;
    }

    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash as Hex,
    });

    const matchesEvent = receipt.logs.some((log) => {
      if (!log.address || !isAddressEqual(log.address, contractAddress)) {
        return false;
      }

      try {
        const decoded = decodeEventLog({
          abi: arenaEconomyAbi,
          data: log.data,
          topics: log.topics,
        });

        return (
          decoded.eventName === "MatchEntered" &&
          decoded.args.matchId === matchIdToBytes32(matchId) &&
          decoded.args.agentId === agentIdToBytes32(agentId)
        );
      } catch {
        return false;
      }
    });

    if (!matchesEvent) {
      return null;
    }

    return {
      txHash,
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      status: receipt.status === "success" ? "confirmed" : "failed",
      purpose: "match_entry",
      agentId,
      matchId,
      explorerUrl: toExplorerTxUrl(
        txHash,
        config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
      ),
      createdAt: new Date().toISOString(),
    } satisfies OnchainReceipt;
  }

  encodePurchaseSkill(agentId: string, skill: SkillKey) {
    const contractAddress = this.getContractAddress();
    if (!contractAddress) {
      return null;
    }

    return {
      to: contractAddress,
      data: encodeFunctionData({
        abi: arenaEconomyAbi,
        functionName: "purchaseSkill",
        args: [agentIdToBytes32(agentId), mapSkillToId(skill)],
      }),
    };
  }

  encodeMatchEntry(matchId: string, agentId: string) {
    const contractAddress = this.getContractAddress();
    if (!contractAddress) {
      return null;
    }

    return {
      to: contractAddress,
      data: encodeFunctionData({
        abi: arenaEconomyAbi,
        functionName: "enterMatch",
        args: [matchIdToBytes32(matchId), agentIdToBytes32(agentId)],
      }),
    };
  }
}
