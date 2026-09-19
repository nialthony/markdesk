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

## Threats and controls

| Threat                    | Initial control                                    | Remaining work                                   |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Stale mark fill           | Program checks `now - observed_at <= max_mark_age` | Define market-specific outage policy             |
| Replayed mark             | Strictly increasing sequence                       | Multi-publisher consensus                        |
| Publisher compromise      | Separate publisher from admin                      | Hardware-backed key and rotation instruction     |
| Arithmetic overflow       | Checked `u128`; bounded decimals and offset        | Property/fuzz tests in Rust                      |
| Rounding underpays maker  | Quote rounds up                                    | Independent reference implementation             |
| Fake mint                 | Mark PDA keyed by mint; configured quote mint      | Explicit PreStocks asset registry                |
| Unauthorized cancellation | Maker signer + PDA constraints                     | Adversarial validator tests                      |
| Vault theft               | Offer PDA authority and deterministic seeds        | Audit and formal account constraint review       |
| Token-2022 fee surprises  | UI and protocol mark unsupported extensions        | Implement gross-up / net-receive checks          |
| Transfer-hook failure     | Fail closed                                        | Pass validated extra-account metas               |
| API outage                | Labeled read-only fallback in web                  | Publisher pauses rather than publishing fallback |
| Misleading UI             | No fake confirmations; source labels               | Wallet integration acceptance tests              |

## Deployment gates

No mainnet deployment until all are true:

- Local-validator tests cover create, fill, cancel, stale mark, replay, wrong mint, wrong maker, expiry, and overflow.
- Actual target mints have been inspected for every Token-2022 extension.
- Transfer fees and hooks are supported or explicitly rejected on-chain.
- Program id and verified source are published.
- Upgrade authority and publisher key policy are documented.
- Independent review is complete.

Even after these gates, start with trivial value and explicit caps.
