# MarkDesk

**Mark-relative OTC orders for tokenized private markets on Solana.**

MarkDesk lets a holder create an offer such as **“sell SpaceX at the latest PreStocks mark minus 3%”** instead of posting a fixed price that becomes stale. A taker fills with USDC; the Solana program checks a fresh published mark and settles both legs atomically.

> Built for the Solana Stocklana hackathon. This repository is an early technical prototype, not an audited production protocol or an offer of financial products.

## Why this exists

Private-market tokens can trade far from their reference mark, while thin liquidity can make AMM execution expensive. Existing dashboards explain the gap. MarkDesk turns the gap into an executable rule:

1. A publisher reads the official PreStocks catalog and publishes a timestamped mark.
2. A maker escrows a supported PreStocks token and chooses an offset in basis points.
3. A taker fills the offer with USDC.
4. The program rejects stale marks, calculates the quote in integer arithmetic, and settles atomically.

## Current state — honest by design

| Component                                                  | Status                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| Live PreStocks catalog and fallback snapshot               | Implemented                                                  |
| Deterministic mark-relative quote math                     | Implemented and tested                                       |
| Publisher normalization and canonical payloads             | Implemented and tested                                       |
| Anchor config, mark, create, fill, and cancel instructions | Initial implementation                                       |
| Token custody                                              | Initial SPL / Token-2022 interface path                      |
| Transfer-hook and net-of-transfer-fee adapters             | Not implemented yet                                          |
| Wallet transaction UI                                      | Not implemented yet; web app is a read-only protocol preview |
| Devnet / mainnet deployment                                | Not deployed                                                 |
| Security audit                                             | Not audited                                                  |

No screen in the app claims a transaction occurred unless it came from confirmed RPC state.

## Repository layout

```text
apps/web/               Next.js market board and offer preview
packages/core/          Shared types, PreStocks normalization, and quote math
services/publisher/     Mark ingestion and canonical snapshot writer
programs/markdesk/      Anchor program
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

Run the mark publisher once:

```bash
npm run publisher -- --once
```

The unsigned normalized snapshot is written to `var/marks.json`. Key management and on-chain publication are intentionally not faked in this bootstrap.

### Anchor program

Install Rust, Solana CLI, and Anchor 1.2+, then:

```bash
cargo test -p markdesk
anchor build
```

The declared program id is a source placeholder until the first deployment. Run `anchor keys sync` before deploying and commit the resulting program-id change, never a deployer keypair.

## Core invariants

- Only the configured quote mint may settle offers.
- Only the configured publisher may update marks.
- Mark sequences must increase and timestamps must be fresh at fill time.
- Offer price calculations use checked `u128` arithmetic and round quote amounts up.
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
