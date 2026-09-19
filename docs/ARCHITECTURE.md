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

The initial transfer path uses Anchor's token interface to support classic SPL and basic Token-2022 accounts. Assets requiring transfer-hook remaining accounts or net-of-transfer-fee guarantees stay disabled until adapters are implemented and tested.

### `apps/web`

The first web milestone is intentionally read-only. It renders live/fallback market data and deterministic offer previews. Wallet buttons and transaction states will only ship alongside RPC confirmation and account re-reads.

## Price representation

A mark is stored as `price_e6`, integer USD micro-units per whole base token. Offsets are signed basis points.

For a base raw amount `B`, base decimals `Db`, quote decimals `Dq`, mark `P`, and offset `O`:

```text
quote_raw = ceil(
  B × P × 10^Dq × (10_000 + O)
  ─────────────────────────────────────
  10^Db × 1_000_000 × 10_000
)
```

The program uses checked `u128` intermediates and rounds up so a maker is never underpaid by integer truncation.

## Trust boundary

Atomic settlement does not make the mark trustless. In v1:

- The configured publisher is trusted to reproduce the official PreStocks API correctly.
- The program guarantees publisher authorization, monotonic sequence, configured freshness, offer terms, and atomic transfers.
- The UI must expose source, timestamp, and publisher address.

A future publisher set can use threshold signatures or independent attestors without changing offer semantics.
