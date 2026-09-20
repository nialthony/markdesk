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

### `tests/validator`

A separate Rust workspace builds MarkDesk as SBF, runs it through `solana-program-test` 3.0.7, and uses that runtime's SBF Token-2022 and associated-token-account fixtures. Its synthetic base mint carries transfer-fee, default-state, permanent-delegate, inactive-hook, pausable, and scaled-UI extensions. The suite executes fee-bearing create → fill and create → cancel, proves atomic failures for every signed settlement bound, inspects withheld amounts, and verifies vault/offer closure. CI also enforces measured compute ceilings; see the [dated SBF report](../research/TOKEN_2022_SBF_VALIDATION_2026-09-20.md).

### `apps/web`

The market board renders live/fallback PreStocks data. The execution console implements the wallet
transaction pipeline:

1. **Wallet connect** through the Solana Wallet Standard (Phantom, Solflare, Backpack register
   automatically); no proprietary adapter dependency.
2. **Cluster-aware RPC** from `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_RPC_URL`, and
   `NEXT_PUBLIC_MARKDESK_PROGRAM_ID`; the cluster, program deployment, and Explorer links always
   reflect the resolved configuration.
3. **Read-before-sign**: the console re-reads config, mark (price, timestamp, sequence, freshness),
   the base mint's active and scheduled fee epochs, active and pending scaled-UI multipliers, pause
   and freeze state, permanent delegate, and transfer-hook state, plus wallet balances. The same
   extension reader powers the dated mainnet inspector.
4. **Transaction builders** for `create_offer`, `fill_offer`, and `cancel_offer` with account
   ordering that mirrors the program's `#[derive(Accounts)]` structs, explicit compute-unit
   budgets, and idempotent ATA creation for missing taker/maker accounts.
5. **Simulate before signing**: the unsigned transaction is simulated against the cluster; the
   wallet is only asked for a signature after a clean simulation.
6. **Explicit signed bounds** shown before the button: minimum escrow credit (create); expected
   mark sequence, minimum buyer net, and maximum quote debit (fill); minimum maker net return
   (cancel).
7. **Blockheight-aware confirmation** (`getLatestBlockhash` + `confirmTransaction` at `confirmed`),
   then account re-reads and Anchor event decoding.
8. **Success only after verification**: the receipt renders `VERIFIED ON-CHAIN` exclusively when
   balance deltas, vault/Offer closure, and the settlement event all match the signed plan. A
   confirmed-but-unverified transaction renders as a mismatch, and an unconfirmed one links to the
   Explorer instead of claiming success.

The UI keeps its **read-only protocol preview** label until the devnet two-wallet
create → fill → cancel run is actually verified; until the program is deployed, every flow renders
its honest blockers instead of a disabled mystery button.

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
