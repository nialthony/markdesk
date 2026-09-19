# Product brief

## User

A holder or buyer of PreStocks who wants predictable execution for a meaningful position without accepting an opaque AMM price or maintaining a stale fixed-dollar order.

## Job to be done

> When I trade a thin private-market token, let me define the price relative to its official mark and settle without counterparty custody, so I can understand exactly what premium or discount I accepted.

## V1 journey

### Maker

1. Connect wallet.
2. Select the supported PreStocks mint.
3. Enter amount, mark offset, and expiry.
4. Review current mark, estimated USDC, freshness, and token restrictions.
5. Sign `create_offer`; wait for confirmation and re-read the Offer PDA.
6. Share the offer URL or cancel before fill.

### Taker

1. Open the offer URL.
2. Review mark source, timestamp, offset, gross token amount, and exact USDC requirement.
3. Simulate and sign `fill_offer`.
4. See confirmed balances and Explorer receipt.

## Non-goals

- Recommending whether an asset is a good investment
- Hiding issuer or jurisdictional restrictions
- Claiming the mark is fair value or cryptographically trustless
- Routing among non-PreStocks private-market products
- Supporting leverage, derivatives, or pooled custody in v1

## Success metric

A judge can complete create → fill with two test wallets in under two minutes and independently verify every state transition on Solana Explorer.
