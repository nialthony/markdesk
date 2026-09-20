/**
 * MarkDesk on-chain protocol codec.
 *
 * Byte-level encoders and decoders for Anchor instructions, accounts, and
 * events. This module is deliberately free of RPC and wallet concerns so it can
 * be unit-tested offline and shared by the web client, the publisher, and
 * deployment tooling.
 *
 * The account ordering for each instruction is documented next to its encoder
 * and must match the `#[derive(Accounts)]` structs in `programs/markdesk`.
 */

import { bytesEqual, BorshReader, BorshWriter, toHex } from "./borsh";
import { sha256 } from "./sha256";

/**
 * Source placeholder from `declare_id!`. The deployable program id is provided
 * by the environment (`NEXT_PUBLIC_MARKDESK_PROGRAM_ID`) after
 * `anchor keys sync`; this constant is only the documented default.
 */
export const MARKDESK_PROGRAM_ID_PLACEHOLDER = "7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk";

/** PDA seed conventions shared by client and program. */
export const MARKDESK_SEEDS = {
  config: "config",
  mark: "mark",
  offer: "offer",
} as const;

/** Signed execution limits mirrored from the program. */
export const MARKDESK_LIMITS = {
  minOffsetBps: -5_000,
  maxOffsetBps: 5_000,
  maxOfferLifetimeSeconds: 30 * 24 * 60 * 60,
  maxFutureMarkSkewSeconds: 30,
} as const;

export function accountDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`account:${name}`)).slice(0, 8);
}

export function instructionDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
}

export function eventDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`event:${name}`)).slice(0, 8);
}

export function hexDiscriminator(name: string): string {
  return toHex(instructionDiscriminator(name));
}

export class ProtocolDecodeError extends Error {
  constructor(
    message: string,
    readonly expectedName: string,
  ) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
}

function readAccount(data: Uint8Array, expectedName: "Config" | "Mark" | "Offer"): BorshReader {
  const expected = accountDiscriminator(expectedName);
  if (data.length < 8) {
    throw new ProtocolDecodeError(
      `account data too short for ${expectedName}: ${data.length} bytes`,
      expectedName,
    );
  }
  if (!bytesEqual(data.subarray(0, 8), expected)) {
    throw new ProtocolDecodeError(
      `account discriminator mismatch for ${expectedName}: got ${toHex(data.subarray(0, 8))}`,
      expectedName,
    );
  }
  return new BorshReader(data.subarray(8));
}

export interface DecodedConfig {
  /** Hex-encoded 32-byte public keys; wrap with a cluster library to render. */
  authority: string;
  publisher: string;
  quoteMint: string;
  maxMarkAgeSeconds: number;
  bump: number;
}

export function decodeConfigAccount(data: Uint8Array): DecodedConfig {
  const reader = readAccount(data, "Config");
  const config: DecodedConfig = {
    authority: toHex(reader.publicKey()),
    publisher: toHex(reader.publicKey()),
    quoteMint: toHex(reader.publicKey()),
    maxMarkAgeSeconds: reader.u32(),
    bump: reader.u8(),
  };
  reader.expectEnd();
  return config;
}

export interface DecodedMark {
  mint: string;
  priceE6: bigint;
  observedAt: bigint;
  sequence: bigint;
  bump: number;
}

export function decodeMarkAccount(data: Uint8Array): DecodedMark {
  const reader = readAccount(data, "Mark");
  const mark: DecodedMark = {
    mint: toHex(reader.publicKey()),
    priceE6: reader.u64(),
    observedAt: reader.i64(),
    sequence: reader.u64(),
    bump: reader.u8(),
  };
  reader.expectEnd();
  return mark;
}

export interface DecodedOffer {
  maker: string;
  baseMint: string;
  quoteMint: string;
  offerId: bigint;
  /** Spendable vault credit recorded at create time. */
  baseAmount: bigint;
  offsetBps: number;
  createdAt: bigint;
  expiresAt: bigint;
  bump: number;
}

export function decodeOfferAccount(data: Uint8Array): DecodedOffer {
  const reader = readAccount(data, "Offer");
  const offer: DecodedOffer = {
    maker: toHex(reader.publicKey()),
    baseMint: toHex(reader.publicKey()),
    quoteMint: toHex(reader.publicKey()),
    offerId: reader.u64(),
    baseAmount: reader.u64(),
    offsetBps: reader.i16(),
    createdAt: reader.i64(),
    expiresAt: reader.i64(),
    bump: reader.u8(),
  };
  reader.expectEnd();
  return offer;
}

// ---------------------------------------------------------------------------
// Instruction data encoders
// ---------------------------------------------------------------------------

/**
 * `initialize_config(publisher: Pubkey, max_mark_age_seconds: u32)`
 *
 * Accounts: authority (signer, payer), config (PDA init), quote_mint,
 * system_program.
 */
export function encodeInitializeConfig(input: {
  /** Raw 32-byte publisher public key. */
  publisher: Uint8Array;
  maxMarkAgeSeconds: number;
}): Uint8Array {
  return new BorshWriter()
    .rawBytes(instructionDiscriminator("initialize_config"))
    .publicKey(input.publisher)
    .u32(input.maxMarkAgeSeconds)
    .toUint8Array();
}

/**
 * `publish_mark(price_e6: u64, observed_at: i64, sequence: u64)`
 *
 * Accounts: publisher (signer), config, base_mint, mark (PDA init_if_needed),
 * system_program.
 */
export function encodePublishMark(input: {
  priceE6: bigint;
  observedAtSeconds: bigint;
  sequence: bigint;
}): Uint8Array {
  return new BorshWriter()
    .rawBytes(instructionDiscriminator("publish_mark"))
    .u64(input.priceE6)
    .i64(input.observedAtSeconds)
    .u64(input.sequence)
    .toUint8Array();
}

export interface CreateOfferArgs {
  offerId: bigint;
  grossBaseAmount: bigint;
  /** Signed lower bound on the vault credit; rejects fee-epoch races. */
  minimumEscrowedAmount: bigint;
  offsetBps: number;
  expiresAtSeconds: bigint;
}

/**
 * `create_offer(offer_id, gross_base_amount, minimum_escrowed_amount,
 * offset_bps, expires_at)`
 *
 * Accounts, in order: maker (signer, writable), config, base_mint, mark,
 * offer (PDA init, writable), maker_base_account (writable), vault (ATA init,
 * writable), base_token_program, associated_token_program, system_program.
 */
export function encodeCreateOffer(args: CreateOfferArgs): Uint8Array {
  if (
    args.offsetBps < MARKDESK_LIMITS.minOffsetBps ||
    args.offsetBps > MARKDESK_LIMITS.maxOffsetBps
  ) {
    throw new RangeError(
      `offsetBps must be within ±${MARKDESK_LIMITS.maxOffsetBps}: ${args.offsetBps}`,
    );
  }
  return new BorshWriter()
    .rawBytes(instructionDiscriminator("create_offer"))
    .u64(args.offerId)
    .u64(args.grossBaseAmount)
    .u64(args.minimumEscrowedAmount)
    .i16(args.offsetBps)
    .i64(args.expiresAtSeconds)
    .toUint8Array();
}

export interface FillOfferArgs {
  /** Mark sequence the taker priced against; rejects mark races. */
  expectedMarkSequence: bigint;
  /** Signed lower bound on the buyer's net base receipt. */
  minimumBuyerNetAmount: bigint;
  /** Signed upper bound on the quote debit. */
  maximumQuoteAmount: bigint;
}

/**
 * `fill_offer(expected_mark_sequence, minimum_buyer_net_amount,
 * maximum_quote_amount)`
 *
 * Accounts, in order: taker (signer, writable), maker (writable, lamports),
 * config, mark, offer (writable, closed), base_mint (writable), quote_mint,
 * vault (writable), taker_base_account (writable), taker_quote_account
 * (writable), maker_quote_account (writable), base_token_program,
 * quote_token_program.
 */
export function encodeFillOffer(args: FillOfferArgs): Uint8Array {
  return new BorshWriter()
    .rawBytes(instructionDiscriminator("fill_offer"))
    .u64(args.expectedMarkSequence)
    .u64(args.minimumBuyerNetAmount)
    .u64(args.maximumQuoteAmount)
    .toUint8Array();
}

/**
 * `cancel_offer(minimum_return_amount: u64)`
 *
 * Accounts, in order: maker (signer, writable), offer (writable, closed),
 * base_mint (writable), vault (writable), maker_base_account (writable),
 * base_token_program.
 */
export function encodeCancelOffer(input: {
  /** Signed lower bound on the maker's net base return. */
  minimumReturnAmount: bigint;
}): Uint8Array {
  return new BorshWriter()
    .rawBytes(instructionDiscriminator("cancel_offer"))
    .u64(input.minimumReturnAmount)
    .toUint8Array();
}

// ---------------------------------------------------------------------------
// Anchor event decoders (from confirmed transaction program logs)
// ---------------------------------------------------------------------------

export interface OfferCreatedEvent {
  offer: string;
  maker: string;
  baseMint: string;
  grossDepositAmount: bigint;
  escrowedAmount: bigint;
  inboundTransferFee: bigint;
  offsetBps: number;
  expiresAt: bigint;
}

export interface OfferFilledEvent {
  offer: string;
  maker: string;
  taker: string;
  grossBaseAmount: bigint;
  buyerNetBaseAmount: bigint;
  outboundTransferFee: bigint;
  scaledQuoteBaseAmount: bigint;
  quoteAmount: bigint;
  markPriceE6: bigint;
  markSequence: bigint;
}

export interface OfferCancelledEvent {
  offer: string;
  maker: string;
  grossReturnAmount: bigint;
  makerNetReturnAmount: bigint;
  returnTransferFee: bigint;
}

export interface MarkPublishedEvent {
  mint: string;
  priceE6: bigint;
  observedAt: bigint;
  sequence: bigint;
}

/** Returns the decoded event payload, or `null` when the log is not the event. */
export function decodeAnchorEvent(
  logBase64: string,
): OfferCreatedEvent | OfferFilledEvent | OfferCancelledEvent | MarkPublishedEvent | null {
  let bytes: Uint8Array;
  try {
    const binary = atob(logBase64);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 8) return null;

  const head = bytes.subarray(0, 8);
  const reader = new BorshReader(bytes.subarray(8));

  try {
    if (bytesEqual(head, eventDiscriminator("OfferCreated"))) {
      const event: OfferCreatedEvent = {
        offer: toHex(reader.publicKey()),
        maker: toHex(reader.publicKey()),
        baseMint: toHex(reader.publicKey()),
        grossDepositAmount: reader.u64(),
        escrowedAmount: reader.u64(),
        inboundTransferFee: reader.u64(),
        offsetBps: reader.i16(),
        expiresAt: reader.i64(),
      };
      reader.expectEnd();
      return event;
    }
    if (bytesEqual(head, eventDiscriminator("OfferFilled"))) {
      const event: OfferFilledEvent = {
        offer: toHex(reader.publicKey()),
        maker: toHex(reader.publicKey()),
        taker: toHex(reader.publicKey()),
        grossBaseAmount: reader.u64(),
        buyerNetBaseAmount: reader.u64(),
        outboundTransferFee: reader.u64(),
        scaledQuoteBaseAmount: reader.u64(),
        quoteAmount: reader.u64(),
        markPriceE6: reader.u64(),
        markSequence: reader.u64(),
      };
      reader.expectEnd();
      return event;
    }
    if (bytesEqual(head, eventDiscriminator("OfferCancelled"))) {
      const event: OfferCancelledEvent = {
        offer: toHex(reader.publicKey()),
        maker: toHex(reader.publicKey()),
        grossReturnAmount: reader.u64(),
        makerNetReturnAmount: reader.u64(),
        returnTransferFee: reader.u64(),
      };
      reader.expectEnd();
      return event;
    }
    if (bytesEqual(head, eventDiscriminator("MarkPublished"))) {
      const event: MarkPublishedEvent = {
        mint: toHex(reader.publicKey()),
        priceE6: reader.u64(),
        observedAt: reader.i64(),
        sequence: reader.u64(),
      };
      reader.expectEnd();
      return event;
    }
  } catch {
    return null;
  }
  return null;
}
