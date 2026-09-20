# MarkDesk Token-2022 SBF validation

Date: **2026-09-20**

Scope: MarkDesk create → fill and create → cancel settlement against extension-enabled synthetic Token-2022 state.

## Result

**PASS.** The MarkDesk SBF artifact executed under `solana-program-test` with SBF Token-2022 and associated-token-account programs. Both settlement paths enforced signed bounds, accounted for both transfer-fee legs, harvested the vault's withheld fee to the mint, and closed the vault and Offer PDA.

This is a validator-runtime integration layer, not a devnet deployment or an audit.

## Reproducible toolchain

- Agave / `cargo-build-sbf`: `3.0.7`
- Platform tools: `v1.54`
- `solana-program-test`: `3.0.7`
- Token-2022 client interface: `2.1.0`
- Associated-token-account client interface: `2.0.0`
- MarkDesk SBF artifact size in this run: `354,976` bytes
- MarkDesk SBF SHA-256 in this run: `8935e475599b505eafda035fb5468d3368479ff371d5ceb5003db5ad653681b7`

`solana-program-test` supplies its matching SBF Token-2022 and associated-token-account fixtures. MarkDesk itself is loaded from `target/deploy/markdesk.so`; it is not substituted with a native processor.

## Synthetic mint shape

The base mint uses 9 decimals and initializes these mint extensions before `InitializeMint2`:

- `TransferFeeConfig`: 50 bps, uncapped for the tested amounts
- `DefaultAccountState`: initialized
- `PermanentDelegate`
- `TransferHook`: extension present, program id unset/inactive
- `Pausable`: extension present, unpaused
- `ScaledUiAmount`: extension present, active multiplier 1×

Token accounts are created through the associated-token-account program, so Token-2022 derives and allocates the required account extensions. The quote mint is a 6-decimal Token-2022 mint without transfer deductions.

## Settlement vectors

### Create → fill

| Check                       | Expected and observed result                                                |
| --------------------------- | --------------------------------------------------------------------------- |
| Maker gross deposit         | `1,000,000,000` raw base units                                              |
| Inbound fee                 | `5,000,000`                                                                 |
| Spendable vault inventory   | `995,000,000`                                                               |
| Outbound fee                | `4,975,000`                                                                 |
| Buyer net                   | `990,025,000`                                                               |
| Mark                        | `$10.000000` (`10,000,000` e6)                                              |
| Quote debit / maker receipt | `9,900,250` raw quote units (`9.900250`)                                    |
| Vault inbound withheld fee  | Harvested to the mint before close                                          |
| Buyer outbound withheld fee | `4,975,000` remains withheld in the buyer account, per Token-2022 semantics |
| Vault                       | Closed                                                                      |
| Offer PDA                   | Closed                                                                      |

Before the successful fill, the suite proves atomic rollback for:

- minimum escrow one unit above the actual vault credit;
- wrong expected mark sequence;
- minimum buyer net one unit above the actual receipt; and
- maximum quote one unit below the calculated debit.

No failed bound attempt changes base or quote balances or leaves partially initialized offer/vault state.

### Create → cancel

| Check                          | Expected and observed result   |
| ------------------------------ | ------------------------------ |
| Vault gross return transfer    | `995,000,000`                  |
| Return fee                     | `4,975,000`                    |
| Maker net return               | `990,025,000`                  |
| Vault inbound withheld fee     | `5,000,000`, harvested to mint |
| Maker destination withheld fee | `4,975,000`                    |
| Vault                          | Closed                         |
| Offer PDA                      | Closed                         |

A minimum return one unit above the actual maker receipt fails atomically before the successful cancellation.

## SBF compute measurements

Measurements are transaction metadata from the successful extension-heavy instructions, including their CPIs. Test-only signer seeds are fixed so PDA bump searches and compute results are deterministic:

| Instruction    | Compute units | CI ceiling |
| -------------- | ------------: | ---------: |
| `create_offer` |        52,607 |     80,000 |
| `fill_offer`   |        44,368 |     70,000 |
| `cancel_offer` |        33,334 |     50,000 |

The integration suite fails if these ceilings are exceeded.

## Reproduce

From the repository root:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v3.0.7/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

cargo build-sbf \
  --manifest-path programs/markdesk/Cargo.toml \
  --tools-version v1.54 \
  --force-tools-install \
  -- \
  --locked

CARGO_TARGET_DIR="$PWD/target" \
  cargo test --manifest-path tests/validator/Cargo.toml --locked -- --nocapture
```

The implementation and assertions are in `tests/validator/tests/token_2022_program_test.rs` and run in the dedicated `validator` GitHub Actions job.

## Remaining boundary

This run does not replace devnet testing against the live upgradeable Token-2022 program or a fresh re-read of the real ANDURIL mint. Wallet simulation, confirmation, post-transaction RPC verification, adversarial account-substitution cases, devnet deployment, and independent review remain release gates.
