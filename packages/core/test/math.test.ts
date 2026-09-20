import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOffsetToPrice,
  calculateFeeAwareSellAmounts,
  calculateGrossDepositForBuyerNetRaw,
  calculateQuoteRaw,
  calculateScaledAmountRaw,
  calculateTransferFeeRaw,
  ceilDiv,
  formatRawAmount,
  parseDecimalToRaw,
} from "../src/index";

test("calculates a mark-relative six-decimal USDC quote", () => {
  const quote = calculateQuoteRaw({
    baseAmountRaw: 250_000n,
    baseDecimals: 6,
    quoteDecimals: 6,
    markPriceE6: 152_500_000n,
    offsetBps: -300,
  });

  assert.equal(quote, 36_981_250n);
  assert.equal(formatRawAmount(quote, 6), "36.98125");
});

test("rounds quote upward to protect the maker", () => {
  const quote = calculateQuoteRaw({
    baseAmountRaw: 1n,
    baseDecimals: 6,
    quoteDecimals: 6,
    markPriceE6: 1_000_001n,
    offsetBps: 0,
  });

  assert.equal(quote, 2n);
});

test("rejects offsets outside the protocol range", () => {
  assert.throws(
    () =>
      calculateQuoteRaw({
        baseAmountRaw: 1n,
        baseDecimals: 0,
        quoteDecimals: 6,
        markPriceE6: 1_000_000n,
        offsetBps: -5_001,
      }),
    /offsetBps/,
  );
});

test("parses and formats decimal amounts without floating point", () => {
  assert.equal(parseDecimalToRaw("0.125", 6), 125_000n);
  assert.equal(formatRawAmount(125_000n, 6), "0.125");
  assert.throws(() => parseDecimalToRaw("0.0000001", 6), /more than 6/);
});

test("ceilDiv and display price behave deterministically", () => {
  assert.equal(ceilDiv(10n, 3n), 4n);
  assert.equal(applyOffsetToPrice(100, -250), 97.5);
});

test("mirrors the two Token-2022 fees paid across escrow and settlement", () => {
  const terms = { basisPoints: 50, maximumFeeRaw: 18_446_744_073_709_551_615n };
  const amounts = calculateFeeAwareSellAmounts(1_000_000_000n, terms);

  assert.deepEqual(amounts, {
    sellerGrossDepositRaw: 1_000_000_000n,
    inboundFeeRaw: 5_000_000n,
    vaultSpendableRaw: 995_000_000n,
    outboundFeeRaw: 4_975_000n,
    buyerNetRaw: 990_025_000n,
  });
  assert.equal(calculateTransferFeeRaw(1n, terms), 1n, "SPL fees round up");
});

test("grosses up both fee legs for an exact buyer-net target", () => {
  const terms = { basisPoints: 100, maximumFeeRaw: 18_446_744_073_709_551_615n };
  const buyerTarget = 1_000_000_000n;
  const sellerGross = calculateGrossDepositForBuyerNetRaw(buyerTarget, terms);
  const actual = calculateFeeAwareSellAmounts(sellerGross, terms);

  assert.equal(actual.buyerNetRaw, buyerTarget);
  assert.ok(calculateFeeAwareSellAmounts(sellerGross - 1n, terms).buyerNetRaw < buyerTarget);
});

test("prices SpaceX-style scaled UI amounts after transfer fees", () => {
  const buyerNetRaw = 990_025_000n;
  assert.equal(calculateScaledAmountRaw(buyerNetRaw, 5_000_000_000n), 4_950_125_000n);

  const quote = calculateQuoteRaw({
    baseAmountRaw: buyerNetRaw,
    baseDecimals: 9,
    quoteDecimals: 6,
    markPriceE6: 100_000_000n,
    offsetBps: 0,
    uiMultiplierE9: 5_000_000_000n,
  });
  assert.equal(quote, 495_012_500n);
});

test("supports the observed OpenAI 1.4861347 multiplier without floating point", () => {
  assert.equal(calculateScaledAmountRaw(990_025_000n, 1_486_134_700n), 1_471_310_506n);
});

test("applyUiMultiplierAsProgram reproduces on-chain f64 truncation", async () => {
  const { applyUiMultiplierAsProgram } = await import("../src/index");
  // Rust: apply_scaled_ui_multiplier(990_025_000, 1.486_134_7) == 1_471_310_506
  assert.equal(applyUiMultiplierAsProgram(990_025_000n, 1.486_134_7), 1_471_310_506n);
  assert.equal(applyUiMultiplierAsProgram(990_025_000n, 5.0), 4_950_125_000n);
  assert.equal(applyUiMultiplierAsProgram(990_025_000n, 1.0), 990_025_000n);
  assert.equal(applyUiMultiplierAsProgram(0n, 1.486_134_7), 0n);
  assert.equal(applyUiMultiplierAsProgram(u64Max(), 1.0), u64Max());
  assert.throws(() => applyUiMultiplierAsProgram(990_025_000n, 0), RangeError);
  assert.throws(() => applyUiMultiplierAsProgram(990_025_000n, Number.NaN), RangeError);
  assert.throws(() => applyUiMultiplierAsProgram(2n ** 53n, 1.5), RangeError);
  // The identity fast path preserves the full u64 range, as on-chain.
  assert.equal(applyUiMultiplierAsProgram(2n ** 53n, 1.0), 2n ** 53n);
});

test("calculateQuoteRawForScaledAmount prices already-scaled receipts", async () => {
  const { calculateQuoteRaw, calculateQuoteRawForScaledAmount } = await import("../src/index");

  const scaledQuote = calculateQuoteRawForScaledAmount({
    scaledBaseAmountRaw: 4_950_125_000n,
    baseDecimals: 9,
    quoteDecimals: 6,
    markPriceE6: 100_000_000n,
    offsetBps: 0,
  });
  assert.equal(scaledQuote, 495_012_500n);

  // The convenience API agrees with the two-step program-mirror path.
  const convenience = calculateQuoteRaw({
    baseAmountRaw: 990_025_000n,
    baseDecimals: 9,
    quoteDecimals: 6,
    markPriceE6: 100_000_000n,
    offsetBps: 0,
    uiMultiplierE9: 5_000_000_000n,
  });
  assert.equal(scaledQuote, convenience);

  assert.equal(
    calculateQuoteRawForScaledAmount({
      scaledBaseAmountRaw: 1_471_310_506n,
      baseDecimals: 9,
      quoteDecimals: 6,
      markPriceE6: 152_500_000n,
      offsetBps: -300,
    }),
    calculateQuoteRaw({
      baseAmountRaw: 990_025_000n,
      baseDecimals: 9,
      quoteDecimals: 6,
      markPriceE6: 152_500_000n,
      offsetBps: -300,
      uiMultiplierE9: 1_486_134_700n,
    }),
  );
});

function u64Max(): bigint {
  return 0xffff_ffff_ffff_ffffn;
}
