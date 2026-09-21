import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizePreStocks, PRESTOCKS_MINTS, type PreStockAsset } from "@markdesk/core";
import { withDemoAsset } from "../lib/catalog";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/prestocks.snapshot.json", import.meta.url),
    "utf8",
  ) as string,
) as { assets: unknown };

const assets: PreStockAsset[] = normalizePreStocks(fixture.assets);

test("demo asset is appended only when a valid mint is configured", () => {
  delete process.env.NEXT_PUBLIC_DEMO_BASE_MINT;
  delete process.env.NEXT_PUBLIC_DEMO_BASE_SYMBOL;
  assert.equal(withDemoAsset(assets).length, assets.length);

  process.env.NEXT_PUBLIC_DEMO_BASE_MINT = "not-a-public-key";
  assert.equal(withDemoAsset(assets).length, assets.length);

  const synthetic = "7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk";
  process.env.NEXT_PUBLIC_DEMO_BASE_MINT = synthetic;
  const enriched = withDemoAsset(assets);
  assert.equal(enriched.length, assets.length + 1);

  const demo = enriched[enriched.length - 1]!;
  assert.equal(demo.mint, synthetic);
  assert.equal(demo.symbol, "SYN-ANDURIL");
  assert.equal(demo.name, "Devnet Synthetic Anduril");
  assert.equal(demo.premiumBps, 0);
  assert.equal(demo.markPriceE6, demo.markPriceE6); // official ANDURIL mark reused
  const anduril = assets.find((asset) => asset.mint === PRESTOCKS_MINTS.ANDURIL)!;
  assert.equal(demo.markPriceE6, anduril.markPriceE6);

  process.env.NEXT_PUBLIC_DEMO_BASE_SYMBOL = "SYN.OPENAI";
  assert.equal(withDemoAsset(assets)[assets.length]!.symbol, "SYN.OPENAI");

  delete process.env.NEXT_PUBLIC_DEMO_BASE_MINT;
  delete process.env.NEXT_PUBLIC_DEMO_BASE_SYMBOL;
});
