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
- [ ] Compile and local-validator integration tests
- [ ] Inspect one actual PreStocks mint's Token-2022 extensions
- [ ] Enable one supported mint end-to-end
- [ ] Wallet create / cancel / fill flows with RPC confirmation
- [ ] Devnet deployment and Explorer links
- [ ] 90-second demo video
- [ ] Judge-oriented submission page

## Ruthless scope

Version one is sell-side, full-fill, one base mint, one quote mint, and one publisher. No partial fills, order matching, AI, baskets, lending, mobile app, or extra pre-IPO issuer.

## Demo script

1. Show token price versus official mark and source timestamp.
2. Maker creates “sell at mark −3%” with a small test balance.
3. Show the Offer PDA and escrow balance on Explorer.
4. Taker fills after a fresh mark update.
5. Re-read both wallets and show the settlement event.
6. Attempt a stale-mark fill and show the program rejection.
7. State the publisher trust boundary and Token-2022 support honestly.

## Internal cutoff

Freeze new features 12 hours before submission. Reserve the final window for a clean clone test, video upload, README verification, and submission form.
