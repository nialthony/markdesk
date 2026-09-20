# Threat model

## Assets at risk

- Base tokens escrowed by makers
- USDC supplied by takers
- Publisher authority
- Admin authority
- Integrity and freshness of reference marks

## Trust assumptions

1. The PreStocks API is the intended off-chain source, but it is not cryptographically authenticated to the Solana program.
2. The configured publisher is trusted to transform source data honestly.
3. Issuer-level controls, transfer hooks, freezes, pauses, and jurisdictional restrictions remain authoritative.
4. Users verify token mint addresses and transaction simulation before signing.
5. The PreStocks issuer currently retains mint, freeze, pause, permanent-delegate, transfer-fee, and scaled-UI authority across the eight scanned mints. Atomic settlement does not neutralize those powers.
6. A product page can add migration or expiry terms independently of the token program; product-status monitoring is therefore part of safe asset support.

The dated evidence and exact addresses are in [`../research/PRESTOCKS_MINT_COMPATIBILITY_2026-09-20.md`](../research/PRESTOCKS_MINT_COMPATIBILITY_2026-09-20.md).

## Threats and controls

| Threat                            | Implemented control                                                                             | Remaining work                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Stale mark fill                   | Program checks `now - observed_at <= max_mark_age`                                              | Define market-specific outage policy                           |
| Replayed mark                     | Strictly increasing sequence                                                                    | Multi-publisher consensus                                      |
| Publisher compromise              | Separate publisher from admin                                                                   | Hardware-backed key and rotation instruction                   |
| Arithmetic overflow               | Checked `u128`; bounded decimals and offset                                                     | Property/fuzz tests in Rust                                    |
| Rounding underpays maker          | Quote rounds up                                                                                 | Independent reference vectors                                  |
| Fake mint                         | Mark PDA keyed by mint; configured quote mint                                                   | Explicit PreStocks asset registry                              |
| Unauthorized cancellation         | Maker signer + PDA constraints                                                                  | Adversarial validator tests                                    |
| Vault authority theft             | Offer PDA authority and deterministic seeds                                                     | Audit and formal account-constraint review                     |
| Transfer-fee underdelivery        | Read active epoch fee; expected-fee CPI; verify exact destination delta; quote buyer net        | Local-validator tests against extension-enabled fixtures       |
| Withheld fee blocks close         | Permissionless harvest to mint before close                                                     | Validator regression for fill and cancel                       |
| Fee schedule changes while listed | Re-read fee; signed minimum escrow, minimum buyer net, maximum quote, and minimum cancel return | Wallet must derive bounds conservatively and simulate          |
| Mark changes before landing       | Fill binds the exact sequence and maximum quote signed by the taker                             | UX for rebuilding expired transactions                         |
| Scaled-UI mispricing              | Apply active multiplier to buyer-net raw amount at fill; signed buyer-net/quote bounds          | SBF compute profiling and cross-language property vectors      |
| Active transfer hook              | Reject any non-zero hook program on-chain                                                       | Validate and forward ExtraAccountMetaList accounts             |
| Permanent delegate drains vault   | Verify vault balance equals offer inventory before collecting quote                             | Cannot remove issuer authority; monitoring and UI warning      |
| Issuer pauses/freezes             | Detect paused state before transfer and surface issuer control                                  | Cancellation can still be blocked by issuer; emergency policy  |
| Fee/multiplier authority changes  | Read mint in the settlement transaction                                                         | Alerting and transaction simulation immediately before signing |
| Quote token deductions            | Require maker's quote balance to increase by the exact calculated amount                        | Explicit quote-mint registry                                   |
| API outage                        | Labeled read-only fallback in web                                                               | Publisher pauses rather than publishing fallback               |
| Product migration/expiry          | SpaceX deadline warning; ANDURIL chosen as flagship                                             | Automated product-status monitoring                            |
| Misleading UI                     | No fake confirmations; source and compatibility labels                                          | Wallet integration acceptance tests                            |

## Deployment gates

No mainnet deployment until all are true:

- Local-validator tests cover create, fee-bearing fill, fee-bearing cancel, withheld-fee harvest, stale mark, replay, wrong mint, wrong maker, expiry, and overflow.
- The program builds for SBF and its compute use is measured on the extension-heavy mint shape.
- Actual target mints are re-inspected immediately before deployment.
- Transfer hooks remain explicitly rejected or validated extra-account support is independently reviewed.
- Product migration/expiry state is checked before an asset enters the registry.
- Program id and verified source are published.
- Upgrade authority and publisher key policy are documented.
- Independent review is complete.

Even after these gates, start with trivial value and explicit caps.
