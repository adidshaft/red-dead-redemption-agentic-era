import { recoverMessageAddress } from "viem";

import { createSessionToken, verifySessionToken } from "./crypto.js";

export function buildNonceMessage(address: string, nonce: string) {
  return [
    "Red Dead Redemption: Agentic Era",
    "Sign in to command your agents on X Layer.",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export async function verifyWalletSignature({
  address,
  nonce,
  signature,
}: {
  address: string;
  nonce: string;
  signature: string;
}) {
  const recovered = await recoverMessageAddress({
    message: buildNonceMessage(address, nonce),
    signature: signature as `0x${string}`,
  });

  return recovered.toLowerCase() === address.toLowerCase();
}

export function issueAccessToken(address: string, secret: string) {
  return createSessionToken(JSON.stringify({ address: address.toLowerCase() }), secret);
}

export function readAddressFromToken(token: string, secret: string) {
  const payload = verifySessionToken(token, secret);
  if (!payload) {
    return null;
  }

  const parsed = JSON.parse(payload) as { address?: string };
  return parsed.address ?? null;
}
