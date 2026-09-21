import {
  MARKDESK_FLAGSHIP_MINT,
  normalizePreStocks,
  PRESTOCKS_MINTS,
  type MarketCatalog,
  type PreStockAsset,
} from "@markdesk/core";
import { PublicKey } from "@solana/web3.js";
import fallbackSnapshot from "../../../fixtures/prestocks.snapshot.json";

const SOURCE_URL = process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";
const TIMEOUT_MS = Number.parseInt(process.env.PRESTOCKS_TIMEOUT_MS ?? "5000", 10);

interface FallbackSnapshot {
  source: string;
  capturedAt: string;
  label: string;
  assets: unknown;
}

/**
 * Appends the devnet synthetic asset when `NEXT_PUBLIC_DEMO_BASE_MINT` is set
 * (written by the devnet bootstrap). It reuses the official ANDURIL mark so
 * the whole console — chain read, signed bounds, settlement — can be exercised
 * on devnet against a Token-2022 mint that actually exists there.
 */
export function withDemoAsset(assets: PreStockAsset[]): PreStockAsset[] {
  const mint = process.env.NEXT_PUBLIC_DEMO_BASE_MINT?.trim();
  if (!mint) return assets;
  try {
    new PublicKey(mint);
  } catch {
    console.warn("NEXT_PUBLIC_DEMO_BASE_MINT is not a valid public key; ignoring it.");
    return assets;
  }

  const anchorAsset = assets.find((asset) => asset.mint === MARKDESK_FLAGSHIP_MINT) ?? assets[0];
  if (!anchorAsset) return assets;

  const symbol = process.env.NEXT_PUBLIC_DEMO_BASE_SYMBOL?.trim() || "SYN-ANDURIL";
  return [
    ...assets,
    {
      ...anchorAsset,
      mint,
      symbol,
      name: "Devnet Synthetic Anduril",
      description:
        "Bootstrap fixture mint that replicates the PreStocks Token-2022 extension profile for devnet testing.",
      tokenPrice: anchorAsset.markPrice,
      premiumBps: 0,
    },
  ];
}

export async function getMarketCatalog(): Promise<MarketCatalog> {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { accept: "application/json", "user-agent": "markdesk-web/0.1" },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);

    return {
      source: "live",
      sourceUrl: SOURCE_URL,
      observedAt: new Date().toISOString(),
      label: "Live PreStocks API",
      assets: withDemoAsset(normalizePreStocks(await response.json())),
    };
  } catch (error) {
    const fixture = fallbackSnapshot as FallbackSnapshot;
    console.warn(
      "PreStocks live fetch failed; serving the labeled repository snapshot.",
      error instanceof Error ? error.message : error,
    );
    return {
      source: "snapshot",
      sourceUrl: fixture.source,
      observedAt: fixture.capturedAt,
      label: fixture.label,
      assets: withDemoAsset(normalizePreStocks(fixture.assets)),
    };
  }
}
