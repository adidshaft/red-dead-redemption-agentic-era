"use client";

import { authorizationTypes } from "@x402/evm";
import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { getAddress, toHex, type Hex } from "viem";

type X402TypedDataSigner = {
  address: `0x${string}`;
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
};

type X402V1Requirements = PaymentRequirements & {
  maxAmountRequired?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

function createNonce() {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return toHex(nonce);
}

function getChainIdFromNetwork(network: string) {
  const [namespace, reference] = network.split(":");
  if (namespace !== "eip155" || !reference) {
    throw new Error(`Unsupported x402 network: ${network}`);
  }

  const chainId = Number(reference);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Invalid x402 chain reference: ${network}`);
  }

  return chainId;
}

export class XLayerExactSchemeV1 implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(private readonly signer: X402TypedDataSigner) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const requirements = paymentRequirements as X402V1Requirements;
    const amount = requirements.maxAmountRequired;
    if (!amount) {
      throw new Error("x402 autonomy quote is missing maxAmountRequired.");
    }

    const chainId = getChainIdFromNetwork(requirements.network);
    const now = Math.floor(Date.now() / 1_000);
    const validForSeconds = Math.max(60, requirements.maxTimeoutSeconds ?? 300);
    const domainName =
      typeof requirements.extra?.name === "string"
        ? requirements.extra.name
        : "USD Coin";
    const domainVersion =
      typeof requirements.extra?.version === "string"
        ? requirements.extra.version
        : "2";

    const authorization = {
      from: this.signer.address,
      to: getAddress(requirements.payTo as `0x${string}`),
      value: amount,
      validAfter: String(now - 60),
      validBefore: String(now + validForSeconds),
      nonce: createNonce(),
    };

    const signature = await this.signer.signTypedData({
      domain: {
        name: domainName,
        version: domainVersion,
        chainId,
        verifyingContract: getAddress(requirements.asset as `0x${string}`),
      },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });

    return {
      x402Version,
      payload: {
        authorization,
        signature,
      },
    };
  }
}
