# Judge path

This file will become the one-sitting evaluation path for the Stocklana submission.

## Compatibility-milestone review

1. Run `npm install && npm run check && npm run dev`.
2. Open the market board and verify the source label says either **Live PreStocks API** or explicitly **Repository fallback snapshot**.
3. Confirm ANDURIL is the default flagship. Change the basis-point offset and generate an unsigned buyer-net offer brief.
4. Select OPENAI to see the scaled-UI warning, then SPACEX to see the March 12, 2027 migration/expiry warning.
5. Confirm the UI never claims that a wallet transaction or fill occurred.
6. Run `npm run inspect:mints -- --output research/prestocks-mint-scan.latest.json` and compare the result with the dated report.
7. Run `npm run publisher -- --once` and inspect `var/marks.json`; it is explicitly unsigned.
8. Run `cargo test -p markdesk`. The regression vectors cover two 50-bps fee legs, SpaceX's 5× multiplier, OpenAI's 1.4861347× multiplier, checked quote rounding, and fail-closed multiplier validation.

## Final submission path (not complete)

The final path must add two-wallet create → confirmed fee-aware escrow → fill → confirmed buyer-net and maker balances → withheld-fee harvest → closed vault, plus stale-mark rejection and Explorer links. Until that exists, the product remains labeled as a protocol preview.
