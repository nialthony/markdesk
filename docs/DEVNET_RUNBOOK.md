# Devnet runbook

From a clean clone to a verified two-wallet create → fill → cancel run on devnet, with Explorer
links for every step. Total time: roughly 30 minutes, most of it toolchain downloads.

The devnet base asset is a **synthetic Token-2022 mint** that replicates the PreStocks extension
profile (50 bps transfer fee with uncapped maximum, permanent delegate, pausable, initialized
default account state, scaled UI at 1×). The real PreStocks mints exist only on mainnet, so devnet
exercises the exact same code paths against a mint we control. Its mark is the official ANDURIL
mark from the PreStocks API, and the UI labels the row `SYN-ANDURIL / Devnet Synthetic Anduril`.

## 0. Prerequisites

- Node.js 20+ and npm 10+ (`npm install`)
- Rust stable plus Agave CLI `3.0.7` and platform tools `v1.54` (same pins as CI)
- About 2 devnet SOL for the payer keypair (faucet: `solana airdrop 2` or
  [faucet.solana.com](https://faucet.solana.com))

## 1. Fix the program id

The committed `declare_id!` is a source placeholder. Generate the deploy keypair and sync the id:

```bash
# With the Anchor CLI (1.2.0):
anchor keys sync

# Or with plain Agave:
solana-keygen new -o target/deploy/markdesk-keypair.json --no-bip39-passphrase
npx tsx scripts/devnet/program-id.ts target/deploy/markdesk-keypair.json
# paste the printed declare_id! into programs/markdesk/src/lib.rs and Anchor.toml
```

Commit the id change. **Never commit the keypair** (`*keypair.json` and `target/` are gitignored).

## 2. Build and deploy

```bash
cargo build-sbf \
  --manifest-path programs/markdesk/Cargo.toml \
  --tools-version v1.54 \
  --force-tools-install \
  -- \
  --locked

solana config set --url devnet
solana airdrop 2
solana program deploy target/deploy/markdesk.so \
  --program-id target/deploy/markdesk-keypair.json
```

## 3. Bootstrap the protocol

```bash
npm run devnet:bootstrap -- --program <deployed-program-id>
```

The bootstrap is idempotent and will:

1. Verify the program is deployed.
2. Create throwaway keypairs under `var/keys/` (gitignored, mode 0600): payer, publisher,
   maker, taker, and the synthetic mint keypairs. **Back these up** — losing the payer loses the
   synthetic mints' mint authority.
3. Create the synthetic base mint and a 6-decimal quote mint (or reuse `--base-mint` /
   `--quote-mint`, e.g. devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` — note the
   config's quote mint is immutable once initialized).
4. `initialize_config` with the publisher keypair and a 300-second maximum mark age.
5. `publish_mark` at the official ANDURIL mark (live API, labeled snapshot fallback, or
   `--mark-usd <number>`).
6. Fund the maker (10 base tokens) and taker (1,000 quote units); `--fund-address <pubkey>` also
   funds an external wallet such as Phantom.
7. Write `var/state/devnet.json` and print the exact `apps/web/.env.local` block.

## 4. Two-wallet acceptance test

```bash
npm run devnet:flow-check -- --program <deployed-program-id>
```

This republishes a fresh mark, then runs create → fill and create → cancel with the maker and
taker keypairs through the **same flow functions as the web console** (read-before-sign, simulate,
signed bounds, blockheight-aware confirmation, balance and closure verification). It prints one
Explorer link per transaction and exits non-zero unless every step reports
`VERIFIED ON-CHAIN`.

## 5. Drive the UI

1. Put the printed block into `apps/web/.env.local`, restart `npm run dev`.
2. The board shows the `SYN-ANDURIL` row (auto-selected) with the official ANDURIL mark.
3. Connect Phantom/Solflare on devnet; fund it first with
   `npm run devnet:bootstrap -- --program <id> --fund-address <your-wallet>`.
4. Sell tab: chain read → signed bounds → simulate & sign → verified receipt → copy offer link.
5. Second wallet: Fill tab with the offer link → three signed bounds → verified receipt.
6. Maker: Cancel tab with the offer address to recover escrow.

## 6. Lifting the read-only label

The UI stays labeled **READ-ONLY PROTOCOL PREVIEW** until, in one sitting:

- [ ] `npm run devnet:flow-check` exits zero;
- [ ] a UI-driven create → fill with two real wallets verifies end to end;
- [ ] a UI-driven cancel verifies; and
- [ ] every receipt links to a confirmed Explorer transaction.

Then update the badge in `apps/web/components/trade-console.tsx`, the status card in
`apps/web/app/page.tsx`, and this checklist with the run date.

## Operational notes

- Devnet airdrops are rate limited; the scripts top up 1 SOL at a time and poll.
- Marks go stale after 300 seconds by design; `devnet:flow-check` republishes before running,
  and the Sell/Fill consoles show the mark age and refuse stale marks.
- The synthetic mint keeps the fixture's issuer powers (permanent delegate, pause authority,
  fee authority) on the payer keypair, so the console's issuer-control row shows them live.
- Re-running bootstrap reuses every account and only tops up balances and publishes a newer mark.
