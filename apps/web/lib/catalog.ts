import { normalizePreStocks, type MarketCatalog } from "@markdesk/core";
import fallbackSnapshot from "../../../fixtures/prestocks.snapshot.json";

const SOURCE_URL = process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";
const TIMEOUT_MS = Number.parseInt(process.env.PRESTOCKS_TIMEOUT_MS ?? "5000", 10);

interface FallbackSnapshot {
  source: string;
  capturedAt: string;
  label: string;
  assets: unknown;
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
      assets: normalizePreStocks(await response.json()),
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
      assets: normalizePreStocks(fixture.assets),
    };
  }
}
