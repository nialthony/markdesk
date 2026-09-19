import {
  buildMarkPayloads,
  canonicalMarkPayload,
  normalizePreStocks,
  type MarkPayload,
  type PreStockAsset,
} from "@markdesk/core";

export interface PublisherRecord extends MarkPayload {
  canonical: string;
}

export interface PublisherSnapshot {
  schema: "markdesk.publisher-snapshot.v1";
  generatedAt: string;
  mode: "live" | "snapshot";
  sourceUrl: string;
  signed: false;
  warning: string;
  assets: PreStockAsset[];
  marks: PublisherRecord[];
}

export function createPublisherSnapshot(
  upstream: unknown,
  options: {
    generatedAt: Date;
    mode: "live" | "snapshot";
    sourceUrl: string;
  },
): PublisherSnapshot {
  const assets = normalizePreStocks(upstream);
  const observedAt = Math.floor(options.generatedAt.getTime() / 1_000);
  const sequenceStart = observedAt * 100;
  const source = new URL(options.sourceUrl).host + new URL(options.sourceUrl).pathname;
  const payloads = buildMarkPayloads(assets, observedAt, sequenceStart, source);

  return {
    schema: "markdesk.publisher-snapshot.v1",
    generatedAt: options.generatedAt.toISOString(),
    mode: options.mode,
    sourceUrl: options.sourceUrl,
    signed: false,
    warning:
      "Unsigned development artifact. It has not been submitted to Solana and must not be treated as an oracle update.",
    assets,
    marks: payloads.map((payload) => ({
      ...payload,
      canonical: canonicalMarkPayload(payload),
    })),
  };
}
