# Architecture

## Product boundary

MarkDesk is a mark-relative OTC settlement protocol. It is not an exchange order book, a broker, a price oracle, or an issuer. Version one supports a maker selling one allowlisted PreStocks token for a configured USDC mint with a full fill.

## Components

```text
PreStocks API
     │
     ▼
mark publisher ── normalized snapshot ──► publisher signer (next milestone)
                                              │
                                              ▼
                                       Mark PDA on Solana
                                              │
Maker wallet ── base token ──► Offer vault ───┼──► Taker wallet
Taker wallet ── USDC ─────────────────────────┴──► Maker wallet
```

### `packages/core`

Network-independent domain code. It normalizes upstream values, calculates premium/discount, validates offsets and timestamps, and computes quote raw amounts using `bigint`. This package is shared by the web app and publisher.

### `services/publisher`

Fetches the documented PreStocks endpoint, rejects malformed rows, converts decimal prices to integer micro-dollars, sorts records deterministically, and writes a canonical snapshot. Signing and submitting an on-chain transaction is deliberately a separate milestone so the bootstrap cannot imply key custody that does not exist.

### `programs/markdesk`

Anchor accounts:

- `Config PDA ["config"]`: admin, publisher, quote mint, maximum mark age.
- `Mark PDA ["mark", base_mint]`: latest price in micro-dollars, source timestamp, monotonic sequence.
- `Offer PDA ["offer", maker, offer_id_le]`: maker, mints, base amount, offset, expiry, and bump.
- Offer ATA: token vault whose authority is the Offer PDA.

Instructions:

1. `initialize_config`
2. `publish_mark`
3. `create_offer`
4. `fill_offer`
5. `cancel_offer`

The base-token path is Token-2022 aware. It reads the active epoch fee, uses `transfer_checked_with_fee`, records the spendable vault credit, prices the buyer's net receipt, harvests withheld vault fees to the mint, and only then closes the vault. A non-zero transfer-hook program is rejected until ExtraAccountMetaList resolution and remaining-account forwarding ship. Quote-token settlement remains fail-closed and requires the maker's balance to increase by the exact calculated amount.

Signed execution bounds prevent configuration races: create includes a minimum escrow credit; fill binds the expected mark sequence, minimum buyer-net base amount, and maximum quote debit; cancel includes a minimum maker-net return.

### `apps/web`

The first web milestone is intentionally read-only. It renders live/fallback market data and deterministic offer previews. Wallet buttons and transaction states will only ship alongside RPC confirmation and account re-reads.

## Price representation

A mark is stored as `price_e6`, integer USD micro-units per displayed base token. Offsets are signed basis points.

Let `G` be the vault's gross outbound amount. The program selects the current epoch's transfer fee from the mint and computes buyer net `N = G - fee(G)`. It then applies Token-2022's active scaled-UI multiplier with the same truncation convention:

```text
B = trunc(N × active_ui_multiplier)
```

For scaled buyer amount `B`, base decimals `Db`, quote decimals `Dq`, mark `P`, and offset `O`:

```text
quote_raw = ceil(
  B × P × 10^Dq × (10_000 + O)
  ─────────────────────────────────────
  10^Db × 1_000_000 × 10_000
)
```

The program uses checked `u128` quote intermediates and rounds up so a maker is never underpaid by integer truncation. Transfer fees are ceiling-rounded according to Token-2022. The TypeScript client additionally provides inverse-fee math to gross up both maker→vault and vault→buyer legs for a requested buyer-net amount.

## Token-2022 close path

```text
maker gross deposit
  └─ fee #1 withheld in vault; net credit becomes offer inventory
       └─ full fill: inventory debited from vault
            ├─ fee #2 withheld in buyer account
            └─ buyer net is the priced economic quantity
                 └─ harvest vault withheld fee → mint
                      └─ close empty vault → maker
```

The mint is writable on fill/cancel because harvesting increments the mint's withheld-fee accumulator. Harvesting is permissionless; withdrawing those fees remains controlled by the mint's configured withdraw authority.

Before quote payment, fill verifies that vault inventory still equals the offer record. This catches out-of-band movement by a permanent delegate. It cannot prevent issuer intervention; it prevents a taker from paying against already-missing inventory.

## Trust boundary

Atomic settlement does not make the mark trustless. In v1:

- The configured publisher is trusted to reproduce the official PreStocks API correctly.
- The program guarantees publisher authorization, monotonic sequence, configured freshness, offer terms, and atomic transfers.
- The UI must expose source, timestamp, and publisher address.

A future publisher set can use threshold signatures or independent attestors without changing offer semantics.
