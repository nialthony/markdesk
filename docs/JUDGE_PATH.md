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
9. With Agave CLI 3.0.7 installed, follow the pinned SBF build and validator-test commands in the README. The extension-heavy fixture proves signed-bound rollback, both transfer-fee legs, exact quote settlement, withheld-fee harvesting, vault/Offer closure, and compute ceilings.
10. Run `npm run test --workspace @markdesk/web`. The console suite proves cluster resolution, PDA derivation, the SBF-validated create/fill/cancel plan vectors (gross 1,000,000,000 → vault 995,000,000 → buyer net 990,025,000 → quote at mark −3%), blocker gating, account ordering, and instruction payloads against independently computed Anchor discriminators.

## Wallet-flow console review

1. Open the board with no wallet connected: the console shows the read-only offer preview and the execution tabs stay informational.
2. The nav cluster pill shows the resolved cluster (Devnet by default). `?offer=<address>` deep-links the Fill tab.
3. Connect a Wallet Standard wallet (Phantom, Solflare, or Backpack). The Sell tab performs a chain read: program deployment, config, mark price/sequence/age, active and scheduled fee epochs, active and pending scaled-UI multipliers, pause state, transfer hook, issuer controls, and your balances.
4. Until the program is deployed on that cluster, the console lists honest blockers instead of enabling execution — that is the expected read-only preview state, not a bug.
5. On a bootstrapped devnet (follow `docs/DEVNET_RUNBOOK.md`), the board shows the `SYN-ANDURIL` synthetic row with the official ANDURIL mark, and the full UI flow works with two devnet wallets.
6. The maker flow shows the gross deposit, both fee legs, buyer net, and the signed minimum-escrow bound, then simulates before requesting a signature, sends, confirms blockheight-aware, and re-reads the Offer PDA, vault, balances, and `OfferCreated` event. Success renders only when every check passes.
7. The Fill tab accepts an offer address (or deep link), shows the three signed bounds (mark sequence, minimum buyer net, maximum quote), and verifies closure of the offer and vault, exact quote deltas on both sides, withheld fee, and the `OfferFilled` event.
8. The Cancel tab verifies the maker's net return, withheld fee, and closure against the `OfferCancelled` event.

## Final submission path (not complete)

The final path must add two-wallet create → confirmed fee-aware escrow → fill → confirmed buyer-net and maker balances → withheld-fee harvest → closed vault, plus stale-mark rejection and Explorer links. Until that exists, the product remains labeled as a protocol preview.
