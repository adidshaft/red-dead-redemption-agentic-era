# X Layer Testnet Runbook

Use this runbook for the live deployment and proof capture pass.

## 1. Fill The Required Env

At minimum:

- `ARENA_OPERATOR_PRIVATE_KEY`
- `APP_TREASURY_ADDRESS`
- `XLAYER_TESTNET_RPC_URL`
- `XLAYER_TESTNET_CHAIN_ID`
- `NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL`
- `NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID`
- `NEXT_PUBLIC_XLAYER_EXPLORER_URL`
- `ONCHAIN_OS_API_KEY`
- `ONCHAIN_OS_API_SECRET`
- `ONCHAIN_OS_API_PASSPHRASE`
- `ONCHAIN_OS_PROJECT_ID`

Important:

- `ONCHAIN_OS_WALLET_BASE_URL` should be the root host, for example `https://web3.okx.com`.
- `OKX_PAYMENTS_BASE_URL` should also be the root host, for example `https://web3.okx.com`.
- Do not include `/api/...` path segments in those base URLs.

## 2. Start Postgres

```bash
docker compose up -d postgres
```

## 3. Verify Testnet Connectivity

```bash
pnpm --filter @rdr/contracts preflight:testnet
```

This should confirm:

- the connected chain ID matches the env value
- the operator wallet is available
- the operator wallet has non-zero OKB
- the current contract address, if set, actually has bytecode

## 4. Deploy ArenaEconomy

```bash
pnpm --filter @rdr/contracts deploy:testnet
```

This writes a deployment artifact to:

- `packages/contracts/deployments/xlayerTestnet.json`

It also prints the `NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS` value to copy into `.env`.

## 5. Re-run Preflight

After setting `NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS`, run:

```bash
pnpm --filter @rdr/contracts preflight:testnet
```

The deployment section should now show bytecode and the configured operator/treasury.

## 6. Start The App

```bash
pnpm dev
```

## 7. Execute Proof Flow

1. Connect a funded wallet on X Layer testnet.
2. Sign in.
3. Create an agent.
4. Register that agent onchain.
5. Buy one skill.
6. Enter the paid queue.
7. Finish the paid match and wait for settlement.
8. Copy the tx hashes into `docs/proof.md`.

## 8. If The Chain ID Is Wrong

OKX has published conflicting X Layer testnet values on different docs pages. If the connected network differs from the repo default, update both:

- `XLAYER_TESTNET_CHAIN_ID`
- `NEXT_PUBLIC_XLAYER_TESTNET_CHAIN_ID`

Keep the server, deploy script, and web wallet config aligned.
