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
- A funded **persistent devnet payer** (see below)

### Persistent devnet identities (`.devnet/`)

All devnet test identities are **committed** under `.devnet/` (devnet-only
throwaway keypairs, zero real value — see `.devnet/README.md`): payer,
publisher, maker, taker, both synthetic mints, and the stable program id.
Local runs pick them up with:

```bash
export MARKDESK_KEYS_DIR=.devnet
```

### One-time payer funding

The CLI faucet (`solana airdrop`) rate-limits shared IPs (CI runners, VPNs), so
the payer is funded once from a browser:

1. Open <https://faucet.solana.com> and pick **devnet** (its quota is separate
   from the CLI faucet; a GitHub login helps).
2. Airdrop repeatedly to the payer address
   (`solana-keygen pubkey .devnet/markdesk-payer.json`) until it holds
   **≥ 5.2 SOL** — a first deploy pays buffer + program rent (~5 SOL peak);
   redeploys of the existing program only need ~2.7 SOL.

Publisher/maker/taker are topped up from the payer by the bootstrap script, and
a steady-state run burns only fees plus small rent, so one funding session
lasts many runs.

## 1. Fix the program id

The program id is **stable**: it is `.devnet/program.json`. The committed
`declare_id!` in source is a placeholder; CI and local runs sync it:

```bash
cp .devnet/program.json target/deploy/markdesk-keypair.json
npx tsx scripts/devnet/program-id.ts target/deploy/markdesk-keypair.json
# paste the printed declare_id! into programs/markdesk/src/lib.rs and Anchor.toml
```

`.devnet/program.json` is the one program keypair that IS committed (devnet
only); `target/` and `*keypair.json` elsewhere stay gitignored.

## CI runs everything

`.github/workflows/devnet-test.yml` (trigger: push to `arena/**`) syncs the id,
checks the payer balance (best-effort small airdrops, else a clear error
pointing at the web faucet), builds, (re)deploys, bootstraps, and runs the
two-wallet flow check. Logs land as comments on the anchor issue (#1).

## 2. Build and deploy

```bash
cargo build-sbf \
  --manifest-path programs/markdesk/Cargo.toml \
  --tools-version v1.54 \
  --force-tools-install \
  -- \
  --locked

solana config set --url devnet
solana program deploy target/deploy/markdesk.so \
  --program-id target/deploy/markdesk-keypair.json
```

## 3. Bootstrap the protocol

```bash
npm run devnet:bootstrap -- --program <deployed-program-id>
```

The bootstrap is idempotent and will:

1. Verify the program is deployed.
2. Load the persistent keypairs from `.devnet/` (or create throwaway ones under `var/keys/`,
   gitignored, mode 0600, if `MARKDESK_KEYS_DIR` is unset).
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

- [x] `npm run devnet:flow-check` exits zero;
- [x] a create → fill with two wallets verifies end to end;
- [x] a create → cancel verifies; and
- [x] every receipt links to a confirmed Explorer transaction.

**Lifted 2026-09-21** — CI run
[35570247328](https://github.com/nialthony/markdesk/actions/runs/35570247328)
(commit `3beca12`) deployed program
`61Vm7fAF4yfSW3oJDpmKw9rVdjAi82unzzof656teGUw` and ran the two-wallet
create → fill → cancel check through the same flow functions as the web
console; all four transactions report `verified on-chain` with Explorer
receipts (see the anchor issue for the logs). The badge in
`apps/web/components/trade-console.tsx` now reads LIVE ON DEVNET / READ-WRITE
and the status card in `apps/web/app/page.tsx` marks the test PASSED.

A human drive-through of the UI (step 5, two real wallets) is still worth
doing before the demo — it exercises the same flow functions the check ran.

## Operational notes

- Devnet airdrops are rate limited and shared-IP hostile; the payer is funded once via the web
  faucet (see step 0), and the scripts top up sponsored wallets from it, 1 SOL at a time.
- Marks go stale after 300 seconds by design; `devnet:flow-check` republishes before running,
  and the Sell/Fill consoles show the mark age and refuse stale marks.
- The synthetic mint keeps the fixture's issuer powers (permanent delegate, pause authority,
  fee authority) on the payer keypair, so the console's issuer-control row shows them live.
- Re-running bootstrap reuses every account and only tops up balances and publishes a newer mark.
