# Architecture

## Runtime Shape

- `apps/web` handles wallet connection, signed auth, agent management, contract writes, and live arena rendering.
- `apps/server` owns the queue, match loop, AI actions, Postgres records, and transaction reconciliation.
- `packages/shared` keeps the ABI, zod schemas, chain constants, and game math consistent across both apps.
- `packages/contracts` holds the X Layer contract and its tests.

## Match Flow

1. User signs in with a wallet signature.
2. User creates an agent profile on the server.
3. If a contract address is configured, the web client calls `registerAgent` from the player wallet and reports the tx hash back to the server.
4. Paid skill purchases and paid match entry happen from the player wallet directly against `ArenaEconomy`.
5. The server verifies those receipts against emitted contract events before persisting them.
6. The arena simulation stays offchain and server-authoritative for speed.
7. The operator wallet settles the winning treasury onchain when a match finishes.

## OnchainOS

- Wallet API: optional account binding for generated agent treasuries.
- Payments API: x402 bonus route for premium autonomy passes.

## Known Constraints

- Local runtime requires a reachable Postgres instance; this environment did not have a running Docker daemon during verification.
- The x402 route currently exposes the challenge/verification path, but a full wallet-side x402 payment client still needs a funded integration test.
