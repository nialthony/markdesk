import type { QuoteInput } from "./types";

export const PRICE_SCALE = 1_000_000n;
export const BPS_SCALE = 10_000n;
export const MAX_DECIMALS = 18;
export const MIN_OFFSET_BPS = -5_000;
export const MAX_OFFSET_BPS = 5_000;

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}

export function pow10(decimals: number): bigint {
  assertInteger("decimals", decimals);
  if (decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be between 0 and ${MAX_DECIMALS}`);
  }
  return 10n ** BigInt(decimals);
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) throw new RangeError("numerator must be non-negative");
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}

export function validateOffsetBps(offsetBps: number): void {
  assertInteger("offsetBps", offsetBps);
  if (offsetBps < MIN_OFFSET_BPS || offsetBps > MAX_OFFSET_BPS) {
    throw new RangeError(`offsetBps must be between ${MIN_OFFSET_BPS} and ${MAX_OFFSET_BPS}`);
  }
}

/**
 * Calculates the raw quote-token amount for a full fill and rounds up so the
 * maker cannot be underpaid because of integer truncation.
 */
export function calculateQuoteRaw(input: QuoteInput): bigint {
  const { baseAmountRaw, baseDecimals, quoteDecimals, markPriceE6, offsetBps } = input;

  if (baseAmountRaw <= 0n) throw new RangeError("baseAmountRaw must be positive");
  if (markPriceE6 <= 0n) throw new RangeError("markPriceE6 must be positive");
  validateOffsetBps(offsetBps);

  const offsetFactor = BPS_SCALE + BigInt(offsetBps);
  const numerator = baseAmountRaw * markPriceE6 * pow10(quoteDecimals) * offsetFactor;
  const denominator = pow10(baseDecimals) * PRICE_SCALE * BPS_SCALE;

  return ceilDiv(numerator, denominator);
}

export function parseDecimalToRaw(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new TypeError("value must be a non-negative decimal string");
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new RangeError(`value has more than ${decimals} decimal places`);
  }

  return BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatRawAmount(raw: bigint, decimals: number, maxFraction = decimals): string {
  if (raw < 0n) throw new RangeError("raw must be non-negative");
  const scale = pow10(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, "0");
  const shown = fraction.slice(0, Math.min(decimals, maxFraction)).replace(/0+$/, "");
  return shown.length > 0 ? `${whole}.${shown}` : whole.toString();
}

export function applyOffsetToPrice(markPrice: number, offsetBps: number): number {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new RangeError("markPrice must be a positive finite number");
  }
  validateOffsetBps(offsetBps);
  return markPrice * (1 + offsetBps / 10_000);
}
