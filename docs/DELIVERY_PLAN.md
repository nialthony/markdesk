# Stocklana delivery plan

Submission deadline: **25 September 2026, 4:00 PM ET** (26 September, approximately 03:00 WIB).

## Product sentence

MarkDesk is a Solana escrow where PreStocks holders post offers relative to the latest official mark and settle atomically in USDC.

## Must ship

- [x] Product thesis and trust model
- [x] Live PreStocks market board with honest fallback
- [x] Shared integer quote implementation and unit tests
- [x] Publisher normalization pipeline
- [x] Initial Anchor account model and instruction implementation
- [x] Host compile, Rust tests, and clippy
- [x] Inspect all eight live PreStocks Token-2022 mints
- [x] Implement epoch-fee, buyer-net, scaled-UI, and withheld-fee logic
- [x] SBF validator-runtime integration tests with extension-enabled fixtures
- [x] Measure create / fill / cancel SBF compute and enforce CI ceilings
- [ ] Enable ANDURIL end-to-end
- [ ] Wallet create / cancel / fill flows with RPC confirmation
- [ ] Devnet deployment and Explorer links
- [ ] 90-second demo video
- [ ] Judge-oriented submission page

## Ruthless scope

Version one is sell-side, full-fill, one supported base mint at launch, one quote mint, and one publisher. No partial fills, order matching, AI, baskets, lending, mobile app, or extra pre-IPO issuer.

**Flagship:** ANDURIL. It exercises real transfer-fee and issuer-control behavior without a currently active scaled multiplier or product migration banner. OPENAI and SPACEX stay regression vectors for scaled-UI math; SPACEX is not a flagship because its legacy token has a March 12, 2027 swap deadline.

## Demo script

1. Show ANDURIL token price versus official mark and source timestamp.
2. Show the dated eight-mint extension audit and explain the two fee legs.
3. Maker requests a buyer-net amount at “mark −3%”; the client shows the gross deposit.
4. Show the confirmed Offer PDA, net vault inventory, and inbound withheld fee.
5. Taker fills after a fresh mark update.
6. Re-read both wallets and show buyer net, maker USDC, fee harvest, vault closure, and settlement event.
7. Attempt a stale-mark fill and show the program rejection.
8. State publisher trust and issuer pause/freeze/permanent-delegate powers honestly.

## Internal cutoff

Freeze new features 12 hours before submission. Reserve the final window for a clean clone test, video upload, README verification, and submission form.
