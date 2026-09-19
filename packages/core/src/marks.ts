import type { MarkPayload, PreStockAsset } from "./types";

export function isMarkFresh(
  observedAtSeconds: number,
  nowSeconds: number,
  maxAgeSeconds: number,
  maxFutureSkewSeconds = 30,
): boolean {
  if (
    ![observedAtSeconds, nowSeconds, maxAgeSeconds, maxFutureSkewSeconds].every(Number.isInteger)
  ) {
    throw new TypeError("mark freshness arguments must be integer seconds");
  }
  if (maxAgeSeconds < 0 || maxFutureSkewSeconds < 0) {
    throw new RangeError("age and skew limits must be non-negative");
  }
  return (
    observedAtSeconds <= nowSeconds + maxFutureSkewSeconds &&
    nowSeconds - observedAtSeconds <= maxAgeSeconds
  );
}

export function buildMarkPayloads(
  assets: PreStockAsset[],
  observedAt: number,
  sequenceStart: number,
  source: string,
): MarkPayload[] {
  if (!Number.isInteger(observedAt) || observedAt <= 0) {
    throw new RangeError("observedAt must be positive integer seconds");
  }
  if (!Number.isSafeInteger(sequenceStart) || sequenceStart <= 0) {
    throw new RangeError("sequenceStart must be a positive safe integer");
  }

  return [...assets]
    .sort((a, b) => a.mint.localeCompare(b.mint))
    .map((asset, index) => ({
      mint: asset.mint,
      priceE6: asset.markPriceE6,
      observedAt,
      sequence: sequenceStart + index,
      source,
    }));
}

export function canonicalMarkPayload(payload: MarkPayload): string {
  return [
    "MARKDESK_MARK_V1",
    payload.mint,
    payload.priceE6,
    payload.observedAt.toString(),
    payload.sequence.toString(),
    payload.source,
  ].join("|");
}
