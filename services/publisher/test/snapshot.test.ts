import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherSnapshot } from "../src/snapshot.js";

const upstream = [
  {
    name: "OpenAI PreStocks",
    symbol: "OPENAI",
    description: "Test record",
    image: "https://example.com/openai.png",
    external_url: "https://example.com/openai",
    contract_address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    markPrice: 987.098793,
    markValuation: 1_222_946_602_654,
    tokenPrice: 1_140.51,
    impliedValuation: 1_413_012_439_933,
    supply: 2_826.46,
  },
];

test("creates an explicitly unsigned deterministic publisher snapshot", () => {
  const snapshot = createPublisherSnapshot(upstream, {
    generatedAt: new Date("2026-09-19T00:00:00.000Z"),
    mode: "live",
    sourceUrl: "https://prestocks.com/api/prestocks",
  });

  assert.equal(snapshot.signed, false);
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.marks[0]?.priceE6, "987098793");
  assert.match(snapshot.marks[0]?.canonical ?? "", /^MARKDESK_MARK_V1\|/);
  assert.match(snapshot.warning, /Unsigned/);
});
