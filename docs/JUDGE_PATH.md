# Judge path

This file will become the one-sitting evaluation path for the Stocklana submission.

## Bootstrap review (today)

1. Run `npm install && npm run check && npm run dev`.
2. Open the market board and verify the source label says either **Live PreStocks API** or explicitly **Repository fallback snapshot**.
3. Select SpaceX or OpenAI and change the basis-point offset in Offer Studio.
4. Generate an unsigned offer brief; note that the UI does not claim a wallet transaction.
5. Run `npm run publisher -- --once` and inspect `var/marks.json`; it is explicitly unsigned.
6. Run `cargo test -p markdesk` to compare the Rust quote calculation with the TypeScript reference.

## Final submission path (not complete)

The final path must add two-wallet create → confirmed escrow → fill → confirmed balances, plus a stale-mark rejection and Explorer links. Until that exists, the product must remain labeled as a protocol preview.
