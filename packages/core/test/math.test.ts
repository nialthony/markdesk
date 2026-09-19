import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOffsetToPrice,
  calculateQuoteRaw,
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
