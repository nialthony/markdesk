export interface UpstreamPreStock {
  name: unknown;
  symbol: unknown;
  description: unknown;
  image: unknown;
  external_url: unknown;
  contract_address: unknown;
  markPrice: unknown;
  markValuation: unknown;
  tokenPrice: unknown;
  impliedValuation: unknown;
  supply: unknown;
}

export interface PreStockAsset {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  externalUrl: string;
  mint: string;
  markPrice: number;
  markPriceE6: string;
  markValuation: number;
  tokenPrice: number;
  impliedValuation: number;
  supply: number;
  premiumBps: number;
}

export interface MarketCatalog {
  source: "live" | "snapshot";
  sourceUrl: string;
  observedAt: string;
  label: string;
  assets: PreStockAsset[];
}

export interface QuoteInput {
  baseAmountRaw: bigint;
  baseDecimals: number;
  quoteDecimals: number;
  markPriceE6: bigint;
  offsetBps: number;
}

export interface MarkPayload {
  mint: string;
  priceE6: string;
  observedAt: number;
  sequence: number;
  source: string;
}
