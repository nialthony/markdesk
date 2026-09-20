# Product brief

## User

A holder or buyer of PreStocks who wants predictable execution for a meaningful position without accepting an opaque AMM price or maintaining a stale fixed-dollar order.

## Job to be done

> When I trade a thin private-market token, let me define the price relative to its official mark and settle without counterparty custody, so I can understand exactly what premium or discount I accepted.

## V1 journey

### Maker

1. Connect wallet.
2. Select the supported PreStocks mint.
3. Enter the buyer-net target amount, mark offset, and expiry.
4. Review current mark, estimated USDC, gross maker deposit, both Token-2022 fee legs, freshness, and issuer restrictions.
5. Re-read the live fee, multiplier, pause, and hook state; simulate; then sign `create_offer` and wait for confirmation before re-reading the Offer PDA.
6. Share the offer URL or cancel before fill.

### Taker

1. Open the offer URL.
2. Review mark source, timestamp, offset, vault gross amount, expected transfer fee, buyer-net amount, active scaled-UI multiplier, and exact USDC requirement.
3. Re-read and simulate the transaction, then sign `fill_offer`.
4. See confirmed balances, fee harvest, closed vault, and Explorer receipt.

## Non-goals

- Recommending whether an asset is a good investment
- Hiding issuer or jurisdictional restrictions
- Claiming the mark is fair value or cryptographically trustless
- Routing among non-PreStocks private-market products
- Supporting leverage, derivatives, or pooled custody in v1

## Success metric

A judge can complete create → fill with two test wallets in under two minutes and independently verify every state transition on Solana Explorer.
