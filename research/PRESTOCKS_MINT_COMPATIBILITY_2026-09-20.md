# PreStocks Token-2022 compatibility scan

Point-in-time mainnet audit for MarkDesk, observed at Solana epoch **1038**, slot **448,479,607**, cluster timestamp **2026-09-19 17:48:36 UTC**. The machine-readable evidence is [`prestocks-mint-scan-2026-09-20.json`](./prestocks-mint-scan-2026-09-20.json).

> Authorities, fees, pause state, hooks, and scaled-UI multipliers are mutable. Clients and the program must re-read the mint at execution; this report is evidence, not a permanent allowlist.

## Decision

**Use ANDURIL as the first flagship asset.** At the observation point it has a 1× UI multiplier, the largest displayed supply among the 1× candidates, no active transfer hook, and no migration/expiry banner on its PreStocks product page. It still exercises the important real-world path: transfer fees, withheld-fee harvesting, pausing, freezing, and a permanent delegate.

Do **not** use SPACEX as the flagship. Its product page states that SpaceX has gone public and that the legacy PreStocks token must be swapped before **11:59 PM UTC on March 12, 2027** or expire worthless.

## Eight-mint matrix

All eight accounts are owned by Token-2022 and use 9 decimals.

| Asset      | Mint                                          | Active fee |         Scheduled fee | Active UI multiplier | Hook     | Paused | Pilot                  |
| ---------- | --------------------------------------------- | ---------: | --------------------: | -------------------: | -------- | ------ | ---------------------- |
| ANDURIL    | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | **yes**                |
| ANTHROPIC  | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | no                     |
| FIGUREAI   | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | no                     |
| KALSHI     | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | no                     |
| NEURALINK  | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | no                     |
| OPENAI     | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` |     50 bps | 100 bps at epoch 1039 |       **1.4861347×** | inactive | no     | scaled regression      |
| POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` |     50 bps | 100 bps at epoch 1039 |                   1× | inactive | no     | no                     |
| SPACEX     | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` |     50 bps | 100 bps at epoch 1039 |               **5×** | inactive | no     | expiry regression only |

The configured maximum transfer fee is `u64::MAX` for every mint, so the percentage—not a practical cap—governs these sizes.

## Shared extension profile

Every mint exposes the same extension families:

- `PermanentDelegate`
- `DefaultAccountState` (`Initialized`)
- `TransferFeeConfig`
- `ConfidentialTransferMint`
- `ConfidentialTransferFeeConfig`
- `TransferHook`
- `ScaledUiAmountConfig`
- `MetadataPointer`
- `PausableConfig`
- `TokenMetadata`

The transfer-hook record currently contains the all-zero optional key (rendered by the JavaScript SDK as `11111111111111111111111111111111`). It is therefore **inactive**. MarkDesk rejects a future non-zero hook program until validated ExtraAccountMetaList support is implemented.

## Settlement implications

### Two fee legs

A sell offer crosses Token-2022 twice:

1. maker → escrow vault;
2. escrow vault → buyer.

At 50 bps, depositing 1.000000000 raw-display token produces:

```text
seller gross       1.000000000
inbound fee        0.005000000
vault spendable    0.995000000
outbound fee       0.004975000
buyer net          0.990025000
```

MarkDesk stores the spendable vault credit as inventory and prices the buyer's net receipt. A client that promises a particular buyer-net amount must gross up both legs. The active fee is selected from the mint using the current epoch in the transaction.

### Withheld fees and vault closure

The inbound fee is withheld in the vault's `TransferFeeAmount` extension. A zero spendable balance is not enough to close that account. Fill and cancel therefore invoke permissionless `harvest_withheld_tokens_to_mint` on the vault before closing it.

### Scaled UI amount

Reference marks are per displayed token. For quote purposes MarkDesk applies Token-2022's active multiplier to the **buyer-net raw amount**, truncating as Token-2022 does, before integer quote math. This is required now for OPENAI and SPACEX and remains dynamic for every mint.

### Issuer control is custody risk

For all eight assets, mint authority, freeze authority, permanent delegate, pause authority, transfer-fee authorities, and scaled-UI authority resolve to:

```text
WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc
```

Consequences:

- the issuer can pause transfers, which can temporarily prevent fills and cancellations;
- the issuer can freeze token accounts;
- the permanent delegate can move or burn escrowed inventory without the Offer PDA signature;
- fee and multiplier settings can change under Token-2022 scheduling rules.

The program checks vault inventory before accepting quote payment, but it cannot remove these issuer powers. The UI must show them as explicit settlement and custody risks.

## Implemented protocol policy

- Read current epoch fee data directly from the mint.
- Use `transfer_checked_with_fee` so the expected fee is atomic with settlement.
- Store net vault credit, not the maker's gross debit.
- Quote against buyer-net quantity after the outbound fee.
- Apply the active scaled-UI multiplier at fill time.
- Reject paused mints with a clear error.
- Reject non-zero transfer-hook programs until extra accounts are supported.
- Check the vault still equals recorded inventory before moving quote tokens.
- Bind signed minimum escrow, minimum buyer net, expected mark sequence, maximum quote, and minimum cancel-return limits.
- Harvest withheld vault fees permissionlessly, then close the vault.
- Keep quote-token settlement fail-closed: the maker must receive the exact calculated quote amount.

## Reproduce

```bash
npm install
npm run inspect:mints -- --output research/prestocks-mint-scan.latest.json
```

The inspector reads the live PreStocks catalog and Solana mainnet RPC. A result is valid only for its recorded slot and cluster timestamp.

Rust CI also parses captured public account bytes for ANDURIL, OPENAI, and SPACEX from [`../fixtures/mints`](../fixtures/mints). Those vectors pin the exact production TLV layouts used by fee, pause, hook, and multiplier regression tests without making CI depend on RPC availability.

## Sources

- [PreStocks catalog API](https://prestocks.com/api/prestocks)
- [Anduril product page](https://prestocks.com/anduril)
- [SpaceX product page and migration warning](https://prestocks.com/spacex)
- [Solana Token-2022 transfer-fee extension](https://www.solana-program.com/docs/token-2022/extensions)
- [Solana scaled UI amount extension](https://solana.com/docs/tokens/extensions/scaled-ui-amount)
- [Solana transfer-hook integration](https://solana.com/docs/tokens/extensions/transfer-hook-integration)
