import type { PreStockAsset, UpstreamPreStock } from "./types";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(`${field} must be a finite number >= ${minimum}`);
  }
  return value;
}

export function priceToE6(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("price must be positive and finite");
  }
  return BigInt(Math.round(value * 1_000_000));
}

export function calculatePremiumBps(tokenPrice: number, markPrice: number): number {
  if (!Number.isFinite(tokenPrice) || tokenPrice < 0) {
    throw new RangeError("tokenPrice must be finite and non-negative");
  }
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new RangeError("markPrice must be positive and finite");
  }
  return Math.round(((tokenPrice - markPrice) / markPrice) * 10_000);
}

export function normalizePreStock(value: unknown): PreStockAsset {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("PreStocks row must be an object");
  }

  const row = value as UpstreamPreStock;
  const mint = requiredString(row.contract_address, "contract_address");
  if (!SOLANA_ADDRESS.test(mint)) {
    throw new TypeError("contract_address is not a valid base58 public key shape");
  }

  const markPrice = finiteNumber(row.markPrice, "markPrice", Number.EPSILON);
  const tokenPrice = finiteNumber(row.tokenPrice, "tokenPrice");

  return {
    name: requiredString(row.name, "name"),
    symbol: requiredString(row.symbol, "symbol").toUpperCase(),
    description: requiredString(row.description, "description"),
    imageUrl: requiredString(row.image, "image"),
    externalUrl: requiredString(row.external_url, "external_url"),
    mint,
    markPrice,
    markPriceE6: priceToE6(markPrice).toString(),
    markValuation: finiteNumber(row.markValuation, "markValuation"),
    tokenPrice,
    impliedValuation: finiteNumber(row.impliedValuation, "impliedValuation"),
    supply: finiteNumber(row.supply, "supply"),
    premiumBps: calculatePremiumBps(tokenPrice, markPrice),
  };
}

export function normalizePreStocks(value: unknown): PreStockAsset[] {
  if (!Array.isArray(value)) throw new TypeError("PreStocks response must be an array");
  const assets = value.map(normalizePreStock);
  const symbols = new Set<string>();
  const mints = new Set<string>();

  for (const asset of assets) {
    if (symbols.has(asset.symbol)) throw new TypeError(`duplicate symbol: ${asset.symbol}`);
    if (mints.has(asset.mint)) throw new TypeError(`duplicate mint: ${asset.mint}`);
    symbols.add(asset.symbol);
    mints.add(asset.mint);
  }

  return assets.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
