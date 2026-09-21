# MarkDesk

**Mark-relative OTC orders for tokenized private markets on Solana.**

MarkDesk lets a holder create an offer such as **“sell Anduril at the latest PreStocks mark minus 3%”** instead of posting a fixed price that becomes stale. A taker fills with USDC; the Solana program checks a fresh published mark and settles both legs atomically.

> Built for the Solana Stocklana hackathon. This repository is an early technical prototype, not an audited production protocol or an offer of financial products.

## Why this exists

Private-market tokens can trade far from their reference mark, while thin liquidity can make AMM execution expensive. Existing dashboards explain the gap. MarkDesk turns the gap into an executable rule:

1. A publisher reads the official PreStocks catalog and publishes a timestamped mark.
2. A maker escrows a supported PreStocks token and chooses an offset in basis points.
3. A taker fills the offer with USDC.
4. The program rejects stale marks, calculates the quote in integer arithmetic, and settles atomically.

## Current state — honest by design

| Component                                                  | Status                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| Live PreStocks catalog and fallback snapshot               | Implemented                                                   |
| Eight-mint Token-2022 inspector and dated evidence         | Implemented                                                   |
| Fee-aware, scaled-UI mark-relative quote math              | Implemented and tested                                        |
| Publisher normalization and canonical payloads             | Implemented and tested                                        |
| Anchor config, mark, create, fill, and cancel instructions | Implemented; create/fill/cancel paths SBF-tested              |
| Transfer-fee escrow and withheld-fee harvesting            | Implemented and validator-runtime tested                      |
| Active transfer-hook support                               | Explicitly rejected on-chain until extra metas are supported  |
| Wallet transaction console                                 | Client flows implemented and unit-tested; gated on deployment |
| Devnet / mainnet deployment                                | Not deployed                                                  |
| Security audit                                             | Not audited                                                   |

No screen in the app claims a transaction occurred unless it came from confirmed RPC state. The
console simulates before signing, shows the signed bounds explicitly, confirms blockheight-aware,
and renders success only after re-read balances, vault/Offer closure, and the settlement event all
match. The UI keeps its read-only protocol preview label until the devnet two-wallet run passes.

## Repository layout

```text
apps/web/               Next.js market board and wallet transaction console
packages/core/          Shared types, PreStocks normalization, quote math, and protocol codec
services/publisher/     Mark ingestion and canonical snapshot writer
programs/markdesk/      Anchor program
tests/validator/         SBF ProgramTest settlement suite
fixtures/               Labeled fallback data
scripts/                Validation and developer utilities
docs/                   Architecture, threat model, and delivery plan
```

## Quick start

Requires Node.js 20+ and npm 10+.

```bash
npm install
npm run check
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The web server attempts to load `https://prestocks.com/api/prestocks`; if upstream is unavailable it uses a clearly labeled repository snapshot.

### Wallet transaction console

The execution console (Sell / Fill / Cancel tabs) is cluster-aware and environment-driven:

```bash
NEXT_PUBLIC_SOLANA_CLUSTER=devnet          # devnet | localnet | mainnet-beta
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_MARKDESK_PROGRAM_ID=<program id after anchor keys sync>
```

It connects through the Solana Wallet Standard (Phantom, Solflare, Backpack), re-reads the mark,
fee epoch, scaled-UI multiplier, and issuer controls before anything is signed, simulates the full
transaction, displays the signed minimum/maximum bounds, confirms blockheight-aware, and only then
re-reads balances, vault/Offer closure, and the Anchor settlement event. Until the program is
deployed on the target cluster the console lists its honest blockers; the app keeps its read-only
protocol preview label until the devnet two-wallet run is verified.

### Devnet deployment and two-wallet test

Follow [`docs/DEVNET_RUNBOOK.md`](docs/DEVNET_RUNBOOK.md). In short: fix the program id
(`anchor keys sync` or `scripts/devnet/program-id.ts`), `cargo build-sbf`, `solana program deploy`,
then:

```bash
npm run devnet:bootstrap -- --program <deployed-program-id>   # synthetic mint, config, mark, funded wallets
npm run devnet:flow-check -- --program <deployed-program-id>  # two-wallet create → fill → cancel, verified
```

The bootstrap prints the exact `apps/web/.env.local` block, including the synthetic
`SYN-ANDURIL` demo mint, so the whole console works on devnet against a Token-2022 mint with the
PreStocks extension profile. Until the runbook's checklist is completed on devnet, the UI keeps
its read-only protocol preview label.

Run the mark publisher once:

```bash
npm run publisher -- --once
```

The unsigned normalized snapshot is written to `var/marks.json`. Key management and on-chain publication are intentionally not faked in this bootstrap.

Re-run the mainnet Token-2022 compatibility scan:

```bash
npm run inspect:mints -- --output research/prestocks-mint-scan.latest.json
```

See the [dated compatibility report](research/PRESTOCKS_MINT_COMPATIBILITY_2026-09-20.md). Results are point-in-time because issuer authorities can change fee, multiplier, pause, and hook settings.

### Anchor program

Install stable Rust and Agave CLI 3.0.7, then run the host suite and the pinned SBF validator suite:

```bash
cargo test -p markdesk
cargo build-sbf \
  --manifest-path programs/markdesk/Cargo.toml \
  --tools-version v1.54 \
  --force-tools-install \
  -- \
  --locked
CARGO_TARGET_DIR="$PWD/target" \
  cargo test --manifest-path tests/validator/Cargo.toml --locked
```

The deterministic SBF run measures 52,607 CU for create, 44,368 CU for fill, and 33,334 CU for cancel on the extension-heavy fixture. See the [dated validation report](research/TOKEN_2022_SBF_VALIDATION_2026-09-20.md).

The declared program id is a source placeholder until the first deployment. Run `anchor keys sync` before deploying and commit the resulting program-id change, never a deployer keypair.

## Core invariants

- Only the configured quote mint may settle offers.
- Only the configured publisher may update marks.
- Mark sequences must increase and timestamps must be fresh at fill time.
- Offer price calculations use checked `u128` arithmetic and round quote amounts up.
- Base-token quotes use the buyer's net receipt after the current epoch fee and active scaled-UI multiplier.
- Signed minimum-receive, maximum-quote, and expected-mark-sequence bounds prevent execution races.
- Transfer-fee vaults harvest withheld tokens to the mint before closure.
- Active transfer hooks are rejected until their extra-account metas can be validated and forwarded.
- Makers alone can cancel their offers.
- Each offer PDA is unique to `(maker, offer_id)`.
- The program never treats the upstream API as cryptographically trustless.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) before handling real assets.

## Hackathon wedge

MarkDesk targets one narrow job: **safe, auditable block execution for PreStocks holders without stale fixed-dollar orders**. The PreStocks path must not integrate non-PreStocks pre-IPO assets because that would conflict with the sponsor bounty requirements.

## Official resources

- [Stocklana](https://hackathons.solana.com/hackathons/stocklana)
- [PreStocks API](https://prestocks.com/api/prestocks)
- [PreStocks products](https://prestocks.com/products)
- [Anchor token transfers](https://www.anchor-lang.com/docs/tokens/basics/transfer-tokens)

## License

MIT
