import type { FeeAwareSellAmounts, QuoteInput, TransferFeeTerms } from "./types";

export const PRICE_SCALE = 1_000_000n;
export const BPS_SCALE = 10_000n;
export const UI_MULTIPLIER_SCALE = 1_000_000_000n;
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

function validateTransferFeeTerms(terms: TransferFeeTerms): void {
  assertInteger("basisPoints", terms.basisPoints);
  if (terms.basisPoints < 0 || terms.basisPoints > Number(BPS_SCALE)) {
    throw new RangeError(`basisPoints must be between 0 and ${BPS_SCALE}`);
  }
  if (terms.maximumFeeRaw < 0n) {
    throw new RangeError("maximumFeeRaw must be non-negative");
  }
}

/** Mirrors SPL Token-2022's ceil-rounded transfer-fee calculation. */
export function calculateTransferFeeRaw(preFeeAmountRaw: bigint, terms: TransferFeeTerms): bigint {
  if (preFeeAmountRaw < 0n) throw new RangeError("preFeeAmountRaw must be non-negative");
  validateTransferFeeTerms(terms);
  if (preFeeAmountRaw === 0n || terms.basisPoints === 0) return 0n;

  const rawFee = ceilDiv(preFeeAmountRaw * BigInt(terms.basisPoints), BPS_SCALE);
  return rawFee < terms.maximumFeeRaw ? rawFee : terms.maximumFeeRaw;
}

export function calculatePostFeeAmountRaw(
  preFeeAmountRaw: bigint,
  terms: TransferFeeTerms,
): bigint {
  return preFeeAmountRaw - calculateTransferFeeRaw(preFeeAmountRaw, terms);
}

/** Mirrors SPL Token-2022's smallest-gross-amount inverse fee calculation. */
export function calculatePreFeeAmountRaw(
  postFeeAmountRaw: bigint,
  terms: TransferFeeTerms,
): bigint {
  if (postFeeAmountRaw < 0n) throw new RangeError("postFeeAmountRaw must be non-negative");
  validateTransferFeeTerms(terms);

  const bps = BigInt(terms.basisPoints);
  if (bps === 0n || postFeeAmountRaw === 0n) return postFeeAmountRaw;
  if (bps === BPS_SCALE) return postFeeAmountRaw + terms.maximumFeeRaw;

  const rawPreFee = ceilDiv(postFeeAmountRaw * BPS_SCALE, BPS_SCALE - bps);
  return rawPreFee - postFeeAmountRaw >= terms.maximumFeeRaw
    ? postFeeAmountRaw + terms.maximumFeeRaw
    : rawPreFee;
}

export function calculateFeeAwareSellAmounts(
  sellerGrossDepositRaw: bigint,
  inboundTerms: TransferFeeTerms,
  outboundTerms: TransferFeeTerms = inboundTerms,
): FeeAwareSellAmounts {
  if (sellerGrossDepositRaw <= 0n) {
    throw new RangeError("sellerGrossDepositRaw must be positive");
  }
  const inboundFeeRaw = calculateTransferFeeRaw(sellerGrossDepositRaw, inboundTerms);
  const vaultSpendableRaw = sellerGrossDepositRaw - inboundFeeRaw;
  const outboundFeeRaw = calculateTransferFeeRaw(vaultSpendableRaw, outboundTerms);
  const buyerNetRaw = vaultSpendableRaw - outboundFeeRaw;

  return {
    sellerGrossDepositRaw,
    inboundFeeRaw,
    vaultSpendableRaw,
    outboundFeeRaw,
    buyerNetRaw,
  };
}

/** Grosses up both escrow-in and settlement-out so the buyer receives the target net. */
export function calculateGrossDepositForBuyerNetRaw(
  buyerNetRaw: bigint,
  inboundTerms: TransferFeeTerms,
  outboundTerms: TransferFeeTerms = inboundTerms,
): bigint {
  if (buyerNetRaw <= 0n) throw new RangeError("buyerNetRaw must be positive");
  const outboundGross = calculatePreFeeAmountRaw(buyerNetRaw, outboundTerms);
  return calculatePreFeeAmountRaw(outboundGross, inboundTerms);
}

/** Token-2022 displays floor(raw × multiplier), keeping the mint's decimal scale. */
export function calculateScaledAmountRaw(
  rawAmount: bigint,
  uiMultiplierE9 = UI_MULTIPLIER_SCALE,
): bigint {
  if (rawAmount < 0n) throw new RangeError("rawAmount must be non-negative");
  if (uiMultiplierE9 <= 0n) throw new RangeError("uiMultiplierE9 must be positive");
  return (rawAmount * uiMultiplierE9) / UI_MULTIPLIER_SCALE;
}

export function validateOffsetBps(offsetBps: number): void {
  assertInteger("offsetBps", offsetBps);
  if (offsetBps < MIN_OFFSET_BPS || offsetBps > MAX_OFFSET_BPS) {
    throw new RangeError(`offsetBps must be between ${MIN_OFFSET_BPS} and ${MAX_OFFSET_BPS}`);
  }
}

/**
 * Prices the buyer's net base receipt using the active scaled-UI multiplier,
 * then rounds quote units up so integer truncation cannot underpay the maker.
 */
export function calculateQuoteRaw(input: QuoteInput): bigint {
  const {
    baseAmountRaw,
    baseDecimals,
    quoteDecimals,
    markPriceE6,
    offsetBps,
    uiMultiplierE9 = UI_MULTIPLIER_SCALE,
  } = input;

  if (baseAmountRaw <= 0n) throw new RangeError("baseAmountRaw must be positive");
  if (markPriceE6 <= 0n) throw new RangeError("markPriceE6 must be positive");
  validateOffsetBps(offsetBps);

  const scaledBaseAmountRaw = calculateScaledAmountRaw(baseAmountRaw, uiMultiplierE9);
  if (scaledBaseAmountRaw <= 0n) {
    throw new RangeError("scaled base amount must be positive");
  }
  const offsetFactor = BPS_SCALE + BigInt(offsetBps);
  const numerator = scaledBaseAmountRaw * markPriceE6 * pow10(quoteDecimals) * offsetFactor;
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
