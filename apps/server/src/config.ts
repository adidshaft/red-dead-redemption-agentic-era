import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(currentDir, "../../../.env");

if (existsSync(rootEnvPath)) {
  const envContents = readFileSync(rootEnvPath, "utf8");
  for (const line of envContents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/rdr"),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SERVER_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_XLAYER_EXPLORER_URL: z
    .string()
    .url()
    .default("https://www.okx.com/web3/explorer/xlayer-test"),
  NEXT_PUBLIC_XLAYER_MAINNET_EXPLORER_URL: z
    .string()
    .url()
    .default("https://www.okx.com/web3/explorer/xlayer"),
  NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  ONCHAIN_OS_API_KEY: z.string().optional(),
  ONCHAIN_OS_API_SECRET: z.string().optional(),
  ONCHAIN_OS_API_PASSPHRASE: z.string().optional(),
  ONCHAIN_OS_PROJECT_ID: z.string().optional(),
  ONCHAIN_OS_WALLET_BASE_URL: z.string().url().default("https://web3.okx.com"),
  OKX_PAYMENTS_BASE_URL: z.string().url().default("https://web3.okx.com"),
  ARENA_OPERATOR_PRIVATE_KEY: z.string().optional(),
  XLAYER_TESTNET_RPC_URL: z
    .string()
    .url()
    .default("https://testrpc.xlayer.tech/terigon"),
  XLAYER_TESTNET_CHAIN_ID: z.coerce.number().int().positive().default(1952),
  XLAYER_MAINNET_RPC_URL: z
    .string()
    .url()
    .default("https://rpc.xlayer.tech"),
  XLAYER_MAINNET_CHAIN_ID: z.coerce.number().int().positive().default(196),
  X402_AUTONOMY_ASSET: z
    .string()
    .default("0x74b7f16337b8972027f6196a17a631ac6de26d22"),
  X402_AUTONOMY_ASSET_NAME: z.string().default("USD Coin"),
  X402_AUTONOMY_ASSET_VERSION: z.string().default("2"),
  X402_AUTONOMY_AMOUNT: z.string().default("1000000"),
  X402_AUTONOMY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  APP_TREASURY_ADDRESS: z.string().optional(),
  SESSION_SECRET: z.string().default("rdr-agentic-era-dev-secret"),
  WALLET_ENCRYPTION_SECRET: z
    .string()
    .default("rdr-wallet-encryption-dev-secret"),
});

export const config = envSchema.parse(process.env);
