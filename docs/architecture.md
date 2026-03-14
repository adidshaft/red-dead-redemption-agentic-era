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
4. Paid skill purchases happen from the player wallet directly against `ArenaEconomy`.
5. Paid queueing is two-step: the server reserves a `matchId`, the player calls `enterMatch(matchId, agentId)`, and then the server verifies that exact event before final queue confirmation.
6. Practice matches stay offchain, while paid matches are locked and settled onchain per `matchId`.
7. The arena simulation stays offchain and server-authoritative for speed, but it now runs against map-aware collisions and rotating arena layouts.
8. The operator wallet settles the winning treasury onchain when a paid match finishes.
9. Premium autonomy is a separate x402 lane: the server issues a `402 Payment Required` challenge, the browser signs the x402 quote, and the server settles it through OKX's signed x402 facilitator endpoints.

## OnchainOS

- Wallet API: optional account binding for generated agent treasuries.
- Payments API: x402 premium route for autonomy passes on X Layer mainnet.

## Map Runtime

- `Dust Circuit` is the original frontier town with saloon, hotel, wash, stable, wagon, corral, fences, and tower lanes.
- `Deadrock Gulch` adds a canyon-town layout with sheriff house, dry store, mine-cart pass, telegraph rise, rocks, and chapel bluff.
- Obstacles are no longer decorative. Shared map geometry drives cover lookup, player collision, dodge resolution, pickup placement, objective placement, and caravan routing.

## Known Constraints

- Local runtime requires a reachable Postgres instance; this environment did not have a running Docker daemon during verification.
- The x402 browser path is implemented, but a public proof transaction for the premium lane still depends on a funded X Layer mainnet USDC wallet.
