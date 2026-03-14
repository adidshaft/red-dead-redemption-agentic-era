# Proof Checklist

Use this file as the submission artifact for the required X Layer proof.

## Required Transactions

- [x] Agent registration tx
- [x] Skill purchase tx
- [x] Match entry tx
- [x] Match settlement tx

## Fill In Before Submission

### Contract

- ArenaEconomy address: `0x31a44d5dcA53A0BFB13C79d8dF5ED3148f08DB97`
- Deployment tx: `0xf6573f85ca2dfdc1e4cfee1a027782a1c620d918e3ce984280c12dacb268386a`
- X Layer network: `xlayerTestnet`
- RPC used: `https://testrpc.xlayer.tech/terigon`
- Chain ID: `1952`
- Deployment artifact: `packages/contracts/deployments/xlayerTestnet.json`

### Transaction Hashes

- Agent registration: `0x879412e6086b9c3a07191f21fa7af0adae73fcc133233ae63264ce5f0adb290a`
- Skill purchase: `0x9f4d343091a57050501bc63a0a0af0c337b1e26fc0dc14da407611e0d7a3fae0`
- Match entry: `0x889943b9c505a6258438c9ad7f630b64822d89f283dc919d8c9b2eb774018d8b`
- Match settlement: `0xdb2b0690c42598c0d40840896e73661f7d012120d0cc55bb6739ab182a49c8cf`

### Explorer Links

- Agent registration: `https://www.okx.com/web3/explorer/xlayer-test/tx/0x879412e6086b9c3a07191f21fa7af0adae73fcc133233ae63264ce5f0adb290a`
- Skill purchase: `https://www.okx.com/web3/explorer/xlayer-test/tx/0x9f4d343091a57050501bc63a0a0af0c337b1e26fc0dc14da407611e0d7a3fae0`
- Match entry: `https://www.okx.com/web3/explorer/xlayer-test/tx/0x889943b9c505a6258438c9ad7f630b64822d89f283dc919d8c9b2eb774018d8b`
- Match settlement: `https://www.okx.com/web3/explorer/xlayer-test/tx/0xdb2b0690c42598c0d40840896e73661f7d012120d0cc55bb6739ab182a49c8cf`

### Proof Context

- Player agent used for registration + skill purchase + first paid entry: `Marshal-9KMNN9`
- Agent ID: `01KKND5474Y1Y7TJZZ6X9KMNN9`
- Paid match ID used for proof entry + settlement: `01KKNDS73PRVS48JEXC1AZ8YPE`
- Settlement winner onchain: `01KKNDS73PRVS48JEXC1AZ8YPE-bot-4`
- Additional paid match proof also exists in the database if judges want a second sample.

### Reproduction Steps

1. Connect a wallet on X Layer testnet.
2. Sign in, create an agent, and wait for the `BaseName-ULIDSuffix` profile to appear.
3. Register the agent onchain if the contract is configured. Proof tx above used `Marshal-9KMNN9`.
4. Buy one skill upgrade in the skill shop and wait for the receipt to land in the Onchain History panel.
5. Request a paid queue ticket, submit the `enterMatch(matchId, agentId)` transaction, and wait for the server to confirm queue entry.
6. Let the match settle and capture the settlement tx hash from the receipts panel or database.

### Notes

- If X Layer testnet config changes, record the exact chain ID and RPC that were used for the successful transactions.
- If judges require a mainnet proof later, repeat the same flow with a funded mainnet wallet and replace the hashes above.
- Premium autonomy now has a real x402 browser-to-server path, but this file does not yet include a public mainnet x402 proof hash because the premium lane still needs a funded X Layer mainnet USDC wallet for a final live run.
