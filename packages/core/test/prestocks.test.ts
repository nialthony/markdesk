import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarkPayloads,
  calculatePremiumBps,
  canonicalMarkPayload,
  isMarkFresh,
  normalizePreStocks,
} from "../src/index.js";

const row = {
  name: "SpaceX PreStocks",
  symbol: "spacex",
  description: "A test description",
  image: "https://example.com/spacex.png",
  external_url: "https://example.com/spacex",
  contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
  markPrice: 152.5,
  markValuation: 2_000_000_000_000,
  tokenPrice: 121.25,
  impliedValuation: 1_590_000_000_000,
  supply: 43_000,
};

test("normalizes and sorts PreStocks data", () => {
  const assets = normalizePreStocks([row]);
  assert.equal(assets[0]?.symbol, "SPACEX");
  assert.equal(assets[0]?.markPriceE6, "152500000");
  assert.equal(assets[0]?.premiumBps, -2049);
});

test("rejects duplicate mint addresses", () => {
  assert.throws(() => normalizePreStocks([row, { ...row, symbol: "OTHER" }]), /duplicate mint/);
});

test("computes premium in basis points", () => {
  assert.equal(calculatePremiumBps(115, 100), 1500);
  assert.equal(calculatePremiumBps(80, 100), -2000);
});

test("checks mark age and future skew", () => {
  assert.equal(isMarkFresh(970, 1_000, 60), true);
  assert.equal(isMarkFresh(900, 1_000, 60), false);
  assert.equal(isMarkFresh(1_031, 1_000, 60), false);
});

test("builds deterministic canonical publisher payloads", () => {
  const assets = normalizePreStocks([row]);
  const [payload] = buildMarkPayloads(assets, 1_700_000_000, 42, "prestocks.com/api/prestocks");
  if (!payload) throw new Error("expected one payload");
  assert.equal(
    canonicalMarkPayload(payload),
    `MARKDESK_MARK_V1|${row.contract_address}|152500000|1700000000|42|prestocks.com/api/prestocks`,
  );
});
