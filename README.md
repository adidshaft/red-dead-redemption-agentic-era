# Red Dead Redemption: Agentic Era

Public repo: [github.com/adidshaft/red-dead-redemption-agentic-era](https://github.com/adidshaft/red-dead-redemption-agentic-era)

Lightweight western arena game built for X Layer and OnchainOS. Players create named agents, fund skill upgrades on X Layer, switch between manual and autonomous control, and settle match outcomes onchain.

## What Is In The Repo

- `apps/web`: Next.js 15 client with wallet auth, roster management, X Layer skill purchases, and a Phaser 3 arena.
- `apps/server`: Fastify + Socket.IO backend with wallet-signature auth, Postgres persistence, autonomous decisioning, queueing, and X Layer receipt reconciliation.
- `packages/shared`: shared ABI, game rules, chain config, and API schemas.
- `packages/contracts`: Hardhat contract package for `ArenaEconomy` and its tests.

## Core Features

- Agent creation with `BaseName-<6 char ULID suffix>` naming.
- Five core skills: Quickdraw, Grit, Trailcraft, Tactics, Fortune.
- Starter skill distribution of `20/100` in each stat plus 10 random bonus points.
- Manual or autonomous combat in a 4-agent free-for-all arena.
- X Layer skill purchase and match-entry flows.
- Onchain settlement receipts stored and surfaced in the UI.
- OnchainOS wallet-account binding for agent treasuries.
- x402 payment challenge route for premium autonomy passes.

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Copy the env template and fill the values you have:

```bash
cp .env.example .env
```

3. Start Postgres.

```bash
docker compose up -d postgres
```

4. Run a testnet preflight before deploying.

```bash
pnpm --filter @rdr/contracts preflight:testnet
```

5. Deploy the contract to X Layer testnet after setting `ARENA_OPERATOR_PRIVATE_KEY` and `APP_TREASURY_ADDRESS`.

```bash
pnpm --filter @rdr/contracts deploy:testnet
```

The deploy command writes `packages/contracts/deployments/xlayerTestnet.json` and prints the env lines to copy.

6. Set `NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS` in `.env` to the deployed contract address.

7. Start the app stack.

```bash
pnpm dev
```

The web app defaults to `http://localhost:3000` and the server defaults to `http://localhost:4000`.

## Build And Test

```bash
pnpm build
pnpm test
```

## OnchainOS Notes

- Agent wallets are generated locally and optionally bound to an OnchainOS wallet account through the Wallet API when the OKX API credentials are configured.
- The x402 route is exposed at `POST /payments/x402/autonomy-pass`.
- The current implementation uses the OKX Payments `/supported`, `/verify`, and `/settle` endpoints when payment payloads are supplied.
- `ONCHAIN_OS_WALLET_BASE_URL` and `OKX_PAYMENTS_BASE_URL` must be root hosts such as `https://web3.okx.com`, not full `/api/...` paths.

## X Layer Notes

- The repo currently defaults to the recent X Layer testnet configuration: chain ID `1952`, RPC `https://testrpc.xlayer.tech/terigon`, explorer `https://www.okx.com/web3/explorer/xlayer-test`.
- OKX has published inconsistent testnet snippets on different pages. If your wallet or RPC provider expects a legacy config, override the env values instead of editing code.
- The web wallet config now also reads `NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID`, so the browser and server can be kept aligned if the live network uses a different testnet chain ID.

## Live Deployment

- ArenaEconomy address: `0x31a44d5dcA53A0BFB13C79d8dF5ED3148f08DB97`
- Deployment tx: `0xf6573f85ca2dfdc1e4cfee1a027782a1c620d918e3ce984280c12dacb268386a`
- Network: `xlayerTestnet`
- Chain ID: `1952`
- RPC: `https://testrpc.xlayer.tech/terigon`
- Explorer: [OKX X Layer Testnet Explorer](https://www.okx.com/web3/explorer/xlayer-test)
- Deployment artifact: `packages/contracts/deployments/xlayerTestnet.json`

## Submission Proof

The proof checklist and placeholder tx-hash sections live in [docs/proof.md](/Users/amanpandey/Desktop/rdr/docs/proof.md).

The live deployment checklist lives in [docs/testnet-runbook.md](/Users/amanpandey/Desktop/rdr/docs/testnet-runbook.md).
