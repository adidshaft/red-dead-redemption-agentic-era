# Red Dead Redemption: Agentic Era

Public repo: [github.com/adidshaft/red-dead-redemption-agentic-era](https://github.com/adidshaft/red-dead-redemption-agentic-era)

Lightweight western arena game built for X Layer and OnchainOS. Players create named agents, fund skill upgrades on X Layer, switch between manual and autonomous control, and settle match outcomes onchain. The current product focus is an agentic gameplay loop: autonomous riders fight, rotate for supplies, play the shrinking ring, propose their next upgrades, and route players toward x402-powered premium autonomy.

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
- The web client now keeps the live arena and next-step guidance upfront, while deeper autonomy, onchain, history, and spectating tools sit behind a calmer tabbed operations console.
- The arena HUD now surfaces one live battle directive, danger chips, ring pressure warnings, and nearest-threat cues so a player can understand the match state without reading a wall of text.
- Live signal-drop objectives now appear during rounds to force convergence and reward agents who control tempo inside the ring.
- Autonomous combat behavior includes targeting, ring rotation, pickup routing, reload timing, and fallback survival logic.
- An Autonomy Director surfaces each agent's doctrine, next skill target, economy loop, and x402 upgrade path.
- The planner now exposes an economy readiness score and confidence band so players can see when an agent is actually prepared to push a paid run.
- The planner now also exposes objective posture so each doctrine explains whether it wants to contest, flank, or hold live arena objectives.
- A Campaign Ops Queue turns planner output into the next owner-approved actions so players can execute an agent’s skill buy, paid run, or premium unlock in sequence.
- Every agent now carries a persistent campaign ledger with wins, placements, treasury earnings, hot streaks, and a campaign tier.
- A Frontier Tape panel records recent finished runs with placements, kills, score, payout, and settlement proof so the campaign feels like a real arc instead of a single match.
- A live Autonomy Wire streams in-match directives so the player can see what autonomous riders are trying to do in real time.
- The planner can drive one-click approval flows for the next recommended upgrade or paid run while keeping owner-signed X Layer actions honest.
- Signed-in players can spectate live frontier matches and inspect ring state, paid pots, and the autonomy mix inside each showdown.
- The observer lane now supports live spotlight cards and leader cam so spectators can jump into the most active frontier round and follow the current leader.
- Field Intel now separates critical calls from the raw event feed, making eliminations, ring shifts, objective claims, and settlements easier to parse during live play.
- Premium autonomy activations now feed back into the ledger as receipts, unlock expiry-aware planner guidance, and surface a structured x402 payment challenge in the UI.
- X Layer skill purchase and match-entry flows.
- Onchain settlement receipts stored and surfaced in the UI.
- A Chain Ops Board summarizes registrations, skill buys, paid entries, settlements, premium activations, and the latest confirmed explorer link per agent.
- OnchainOS wallet-account binding for agent treasuries.
- x402 payment challenge route for premium autonomy passes.

## Agentic Loops

- Combat loop: autonomous agents decide when to chase, reload, dodge, rotate into the safe zone, and contest pickups.
- Objective loop: signal-drop objectives pull riders into contested territory and reward whoever secures the drop with score, ammo, and healing.
- Doctrine loop: each agent derives a doctrine from its skills, and the fallback combat brain now changes firing range, pickup routing, flanking, and center-control behavior to match it.
- Progression loop: the Autonomy Director recommends the next highest-leverage skill buy based on the agent's current stat profile and receipt history.
- Visibility loop: live autonomy directives explain why agents rotate, reload, contest supplies, or force a fight.
- Economy loop: paid match entry, skill upgrades, and settlement all settle on X Layer, while the UI keeps showing the next onchain move the agent wants to make.
- Treasury loop: every agent is created with a linked treasury/subwallet track, so settlement outcomes can feed the next upgrade or queue decision.
- Premium loop: the x402 autonomy pass is the premium lane for stronger planning, tighter queue discipline, and future higher-trust autonomous economy actions.
- Premium state loop: when the autonomy pass is active, the planner switches posture, shows expiry, and records the premium activation as an onchain/autonomy receipt in history.
- Campaign loop: finished matches roll into a long-lived career ledger so agents can build momentum, streaks, and treasury history across multiple showdowns.

## x402 Payment Structure

- The premium autonomy lane is intentionally modeled as a staged x402 flow instead of a one-off toggle.
- The server returns a `402 Payment Required` response from `POST /payments/x402/autonomy-pass` when the agent has not yet settled the premium lane.
- The web surfaces that as a structured payment challenge showing amount, asset, chain, recipient, and the current premium-lane checklist.
- Once the payment settles through the configured OKX/OnchainOS flow, the app:
  - creates an `autonomy_pass` receipt,
  - stores the expiry window,
  - flips the planner into premium mode,
  - and shows the pass inside the same agent ledger as skill buys, match entries, and settlements.
- This keeps the premium AI loop honest: players can see exactly when the premium lane was activated, what it unlocked, and how it feeds the agent’s economy routing.

## Honest Autonomy Model

- Today, player-owned agents can autonomously fight and plan, but onchain skill purchases and paid entries still require the player wallet signature because the contract enforces owner-signed actions.
- House bots are fully operator-managed and can register and enter matches without user intervention.
- The current product therefore supports agent-directed onchain actions with user approval, not invisible custodial spending for player-owned agents.
- This is intentional: it keeps the X Layer proof real while preserving a clear path toward deeper OnchainOS-managed autonomy.

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
- The autonomy planner endpoint is exposed at `GET /agents/:id/autonomy-plan`.
- The campaign ledger endpoint is exposed at `GET /agents/:id/campaign`.
- Recent finished runs are exposed at `GET /agents/:id/matches`.
- The product is structured so x402 is not just a payment stub; it is the premium autonomy lane for higher-trust planning and future agent economy automation.
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

Confirmed live X Layer testnet proof captured so far:

- Agent registration: `0x879412e6086b9c3a07191f21fa7af0adae73fcc133233ae63264ce5f0adb290a`
- Skill purchase: `0x9f4d343091a57050501bc63a0a0af0c337b1e26fc0dc14da407611e0d7a3fae0`
- Match entry: `0x889943b9c505a6258438c9ad7f630b64822d89f283dc919d8c9b2eb774018d8b`
- Match settlement: `0xdb2b0690c42598c0d40840896e73661f7d012120d0cc55bb6739ab182a49c8cf`

The proof checklist, explorer links, and reproduction notes live in [docs/proof.md](/Users/amanpandey/Desktop/rdr/docs/proof.md).

The live deployment checklist lives in [docs/testnet-runbook.md](/Users/amanpandey/Desktop/rdr/docs/testnet-runbook.md).
