import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/rdr"),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SERVER_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_XLAYER_EXPLORER_URL: z.string().url().default("https://www.okx.com/web3/explorer/xlayer-test"),
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
  XLAYER_TESTNET_RPC_URL: z.string().url().default("https://testrpc1.xlayer.tech/terigon"),
  XLAYER_TESTNET_CHAIN_ID: z.coerce.number().int().positive().default(1952),
  APP_TREASURY_ADDRESS: z.string().optional(),
  SESSION_SECRET: z.string().default("rdr-agentic-era-dev-secret"),
  WALLET_ENCRYPTION_SECRET: z.string().default("rdr-wallet-encryption-dev-secret"),
});

export const config = envSchema.parse(process.env);
