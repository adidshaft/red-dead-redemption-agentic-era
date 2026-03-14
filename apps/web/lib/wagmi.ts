"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const chainId = Number(
  process.env.NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID ?? "1952",
);
const rpcUrl =
  process.env.NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL ??
  "https://testrpc.xlayer.tech/terigon";
const mainnetChainId = Number(
  process.env.NEXT_PUBLIC_XLAYER_MAINNET_CHAIN_ID ?? "196",
);
const mainnetRpcUrl =
  process.env.NEXT_PUBLIC_XLAYER_MAINNET_RPC_URL ?? "https://rpc.xlayer.tech";

export const xLayerTestnetChain = defineChain({
  id: chainId,
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
      url:
        process.env.NEXT_PUBLIC_XLAYER_EXPLORER_URL ??
        "https://www.okx.com/web3/explorer/xlayer-test",
    },
  },
  testnet: true,
});

export const xLayerMainnetChain = defineChain({
  id: mainnetChainId,
  name: "X Layer Mainnet",
  nativeCurrency: {
    name: "OKB",
    symbol: "OKB",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [mainnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url:
        process.env.NEXT_PUBLIC_XLAYER_MAINNET_EXPLORER_URL ??
        "https://www.okx.com/web3/explorer/xlayer",
    },
  },
  testnet: false,
});

export const wagmiConfig = createConfig({
  chains: [xLayerTestnetChain, xLayerMainnetChain],
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

        const provider =
          (window as Window & { okxwallet?: unknown; ethereum?: unknown })
            .okxwallet ?? (window as Window & { ethereum?: unknown }).ethereum;
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
    [xLayerMainnetChain.id]: http(mainnetRpcUrl),
  },
  ssr: true,
});
