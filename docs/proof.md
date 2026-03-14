# Proof Checklist

Use this file as the submission artifact for the required X Layer proof.

## Required Transactions

- [ ] Agent registration tx
- [ ] Skill purchase tx
- [ ] Match entry tx
- [ ] Match settlement tx

## Fill In Before Submission

### Contract

- ArenaEconomy address: `0x31a44d5dcA53A0BFB13C79d8dF5ED3148f08DB97`
- Deployment tx: `0xf6573f85ca2dfdc1e4cfee1a027782a1c620d918e3ce984280c12dacb268386a`
- X Layer network: `xlayerTestnet`
- RPC used: `https://testrpc.xlayer.tech/terigon`
- Chain ID: `1952`
- Deployment artifact: `packages/contracts/deployments/xlayerTestnet.json`

### Transaction Hashes

- Agent registration:
- Skill purchase:
- Match entry:
- Match settlement:

### Explorer Links

- Agent registration:
- Skill purchase:
- Match entry:
- Match settlement:

### Reproduction Steps

1. Connect a wallet on X Layer testnet.
2. Sign in, create an agent, and wait for the `BaseName-ULIDSuffix` profile to appear.
3. Register the agent onchain if the contract is configured.
4. Buy one skill upgrade in the skill shop.
5. Request a paid queue ticket, submit the `enterMatch(matchId, agentId)` transaction, and wait for the server to confirm queue entry.
6. Capture the settlement tx hash from the receipts panel.

### Notes

- If X Layer testnet config changes, record the exact chain ID and RPC that were used for the successful transactions.
- If judges require a mainnet proof later, repeat the same flow with a funded mainnet wallet and replace the hashes above.
