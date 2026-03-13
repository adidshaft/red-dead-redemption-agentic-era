"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL ?? "https://testrpc1.xlayer.tech/terigon";

export const xLayerTestnetChain = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: {
    name: "OKB",
    symbol: "OKB",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: process.env.NEXT_PUBLIC_XLAYER_EXPLORER_URL ?? "https://www.okx.com/web3/explorer/xlayer-test",
    },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [xLayerTestnetChain],
  connectors: [
    injected({
      shimDisconnect: true,
      target() {
        if (typeof window === "undefined") {
          return {
            id: "injected",
            name: "Injected Wallet",
            provider: undefined,
          };
        }

        const provider = (window as Window & { okxwallet?: unknown; ethereum?: unknown }).okxwallet ?? (window as Window & { ethereum?: unknown }).ethereum;
        return {
          id: "okx-injected",
          name: "OKX / Injected Wallet",
          provider,
        };
      },
    }),
  ],
  transports: {
    [xLayerTestnetChain.id]: http(rpcUrl),
  },
  ssr: true,
});
