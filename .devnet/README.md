# .devnet — persistent devnet test identities

These are **devnet-only throwaway keypairs with zero real-world value**. They
are committed on purpose so every CI run (`.github/workflows/devnet-test.yml`)
reuses the same identities instead of paying fresh rent for a new program and
re-funding new wallets each run.

| File                      | Role                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `markdesk-payer.json`     | Deploy payer / rent + fee sponsor. **Funded once by a human** via the web faucet. |
| `markdesk-publisher.json` | Mark publisher wallet.                                                            |
| `devnet-maker.json`       | Maker wallet (sells base).                                                        |
| `devnet-taker.json`       | Taker wallet (buys with quote).                                                   |
| `synthetic-base.json`     | Synthetic PreStocks-like Token-2022 base mint.                                    |
| `synthetic-quote.json`    | 6-decimal quote mint.                                                             |
| `program.json`            | Stable MarkDesk program id (deploy/upgrades).                                     |

## One-time funding

The CLI faucet (`solana airdrop`) rate-limits shared CI runner IPs, so the
payer is funded from a browser instead:

1. Open <https://faucet.solana.com> and pick **devnet**.
2. Paste the payer address (`solana-keygen pubkey .devnet/markdesk-payer.json`).
3. Repeat until the wallet holds **≥ 5.2 SOL** (first deploy: buffer + program
   rent; later redeploys only need ~2.7 SOL).

The bootstrap script tops up publisher/maker/taker from the payer, never from
the faucet. A steady-state run burns only transaction fees plus small rent, so
a single funding session lasts many CI runs.

## Revoke / rotate

These keys control a throwaway devnet program and throwaway devnet wallets
only. If they are ever abused, close the program (`solana program close`) and
generate fresh keypairs here — nothing of value is at stake.
