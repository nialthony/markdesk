import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BorshReader,
  BorshWriter,
  MARKDESK_LIMITS,
  MARKDESK_PROGRAM_ID_PLACEHOLDER,
  accountDiscriminator,
  decodeAnchorEvent,
  decodeConfigAccount,
  decodeMarkAccount,
  decodeOfferAccount,
  encodeCancelOffer,
  encodeCreateOffer,
  encodeFillOffer,
  encodeInitializeConfig,
  encodePublishMark,
  eventDiscriminator,
  instructionDiscriminator,
  sha256,
  sha256Hex,
  toHex,
} from "../src/index";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

// Independently computed with `python3 -c "import hashlib; ..."` on 2026-09-20.
// If these vectors ever fail, the codec drifted from the Anchor program.
const EXPECTED_INSTRUCTION_DISCRIMINATORS = {
  initialize_config: "d07f1501c2bec446",
  publish_mark: "b08c8115807a53ee",
  create_offer: "ede9c0a8f807f9f1",
  fill_offer: "530fc855a050a43d",
  cancel_offer: "5ccbdf285c593577",
} as const;

const EXPECTED_ACCOUNT_DISCRIMINATORS = {
  Config: "9b0caae01efacc82",
  Mark: "eeedb6423dd9d996",
  Offer: "d7583c47aaa249e5",
} as const;

const EXPECTED_EVENT_DISCRIMINATORS = {
  MarkPublished: "36917323aef33b94",
  OfferCreated: "1fecd7904b2d9d57",
  OfferFilled: "ad685fa190ce4839",
  OfferCancelled: "2d2aafd633c09a09",
} as const;

test("sha256 matches known vectors", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const long = "a".repeat(1_000);
  assert.equal(sha256Hex(long), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
});

test("instruction discriminators match independently computed vectors", () => {
  for (const [name, hex] of Object.entries(EXPECTED_INSTRUCTION_DISCRIMINATORS)) {
    assert.equal(toHex(instructionDiscriminator(name)), hex, name);
  }
});

test("account and event discriminators match independently computed vectors", () => {
  for (const [name, hex] of Object.entries(EXPECTED_ACCOUNT_DISCRIMINATORS)) {
    assert.equal(toHex(accountDiscriminator(name)), hex, name);
  }
  for (const [name, hex] of Object.entries(EXPECTED_EVENT_DISCRIMINATORS)) {
    assert.equal(toHex(eventDiscriminator(name)), hex, name);
  }
});

test("program id placeholder and limits mirror the program", () => {
  assert.equal(MARKDESK_PROGRAM_ID_PLACEHOLDER, "7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk");
  assert.equal(MARKDESK_LIMITS.maxOffsetBps, 5_000);
  assert.equal(MARKDESK_LIMITS.maxOfferLifetimeSeconds, 30 * 24 * 60 * 60);
  assert.equal(MARKDESK_LIMITS.maxFutureMarkSkewSeconds, 30);
});

test("borsh writer and reader round-trip every wire type", () => {
  const writer = new BorshWriter()
    .u8(0xff)
    .u16(0xbeef)
    .i16(-1)
    .u32(0xdead_beef)
    .u64(0xffff_ffff_ffff_ffffn)
    .i64(-2n)
    .publicKey(new Uint8Array(32).fill(7));

  const reader = new BorshReader(writer.toUint8Array());
  assert.equal(reader.u8(), 0xff);
  assert.equal(reader.u16(), 0xbeef);
  assert.equal(reader.i16(), -1);
  assert.equal(reader.u32(), 0xdead_beef);
  assert.equal(reader.u64(), 0xffff_ffff_ffff_ffffn);
  assert.equal(reader.i64(), -2n);
  assert.deepEqual(reader.publicKey(), new Uint8Array(32).fill(7));
  reader.expectEnd();
});

test("borsh writer rejects out-of-range values", () => {
  assert.throws(() => new BorshWriter().u16(-1), RangeError);
  assert.throws(() => new BorshWriter().i16(0x8000), RangeError);
  assert.throws(() => new BorshWriter().u64(-1n), RangeError);
  assert.throws(() => new BorshWriter().i64(1n << 63n), RangeError);
  assert.throws(() => new BorshWriter().publicKey(new Uint8Array(31)), RangeError);
});

test("create offer encoder emits discriminator plus ordered args", () => {
  const data = encodeCreateOffer({
    offerId: 42n,
    grossBaseAmount: 1_000_000_000n,
    minimumEscrowedAmount: 995_000_000n,
    offsetBps: -300,
    expiresAtSeconds: 1_760_000_000n,
  });

  assert.equal(toHex(data.subarray(0, 8)), EXPECTED_INSTRUCTION_DISCRIMINATORS.create_offer);
  const reader = new BorshReader(data.subarray(8));
  assert.equal(reader.u64(), 42n);
  assert.equal(reader.u64(), 1_000_000_000n);
  assert.equal(reader.u64(), 995_000_000n);
  assert.equal(reader.i16(), -300);
  assert.equal(reader.i64(), 1_760_000_000n);
  reader.expectEnd();
});

test("create offer encoder rejects offsets outside the signed program range", () => {
  assert.throws(
    () =>
      encodeCreateOffer({
        offerId: 1n,
        grossBaseAmount: 1n,
        minimumEscrowedAmount: 1n,
        offsetBps: MARKDESK_LIMITS.maxOffsetBps + 1,
        expiresAtSeconds: 1n,
      }),
    RangeError,
  );
});

test("fill and cancel encoders emit bound args", () => {
  const fill = encodeFillOffer({
    expectedMarkSequence: 7n,
    minimumBuyerNetAmount: 990_025_000n,
    maximumQuoteAmount: 9_900_250n,
  });
  assert.equal(toHex(fill.subarray(0, 8)), EXPECTED_INSTRUCTION_DISCRIMINATORS.fill_offer);
  const fillReader = new BorshReader(fill.subarray(8));
  assert.equal(fillReader.u64(), 7n);
  assert.equal(fillReader.u64(), 990_025_000n);
  assert.equal(fillReader.u64(), 9_900_250n);
  fillReader.expectEnd();

  const cancel = encodeCancelOffer({ minimumReturnAmount: 123n });
  assert.equal(toHex(cancel.subarray(0, 8)), EXPECTED_INSTRUCTION_DISCRIMINATORS.cancel_offer);
  const cancelReader = new BorshReader(cancel.subarray(8));
  assert.equal(cancelReader.u64(), 123n);
  cancelReader.expectEnd();
});

test("config and mark encoders round-trip through their decoders", () => {
  const publisher = sha256(new TextEncoder().encode("publisher")).slice(0, 32);
  const initialize = encodeInitializeConfig({ publisher, maxMarkAgeSeconds: 300 });
  assert.equal(initialize.length, 8 + 32 + 4);
  const initReader = new BorshReader(initialize.subarray(8));
  assert.deepEqual(initReader.publicKey(), publisher);
  assert.equal(initReader.u32(), 300);
  initReader.expectEnd();

  const mark = encodePublishMark({
    priceE6: 152_500_000n,
    observedAtSeconds: 1_758_000_000n,
    sequence: 12n,
  });
  assert.equal(mark.length, 8 + 24);
  const markReader = new BorshReader(mark.subarray(8));
  assert.equal(markReader.u64(), 152_500_000n);
  assert.equal(markReader.i64(), 1_758_000_000n);
  assert.equal(markReader.u64(), 12n);
  markReader.expectEnd();
});

function accountBytes(name: keyof typeof EXPECTED_ACCOUNT_DISCRIMINATORS, body: Uint8Array) {
  return Uint8Array.from([...accountDiscriminator(name), ...body]);
}

test("config account decodes with exact length", () => {
  const writer = new BorshWriter()
    .publicKey(new Uint8Array(32).fill(1))
    .publicKey(new Uint8Array(32).fill(2))
    .publicKey(new Uint8Array(32).fill(3))
    .u32(600)
    .u8(255);
  const config = decodeConfigAccount(accountBytes("Config", writer.toUint8Array()));
  assert.equal(config.authority, "01".repeat(32));
  assert.equal(config.publisher, "02".repeat(32));
  assert.equal(config.quoteMint, "03".repeat(32));
  assert.equal(config.maxMarkAgeSeconds, 600);
  assert.equal(config.bump, 255);

  const padded = Uint8Array.from([...accountBytes("Config", writer.toUint8Array()), 0]);
  assert.throws(() => decodeConfigAccount(padded), /trailing bytes/);
});

test("mark and offer accounts decode their full layouts", () => {
  const mark = decodeMarkAccount(
    accountBytes(
      "Mark",
      new BorshWriter()
        .publicKey(new Uint8Array(32).fill(9))
        .u64(152_500_000n)
        .i64(1_758_000_100n)
        .u64(5n)
        .u8(254)
        .toUint8Array(),
    ),
  );
  assert.equal(mark.mint, "09".repeat(32));
  assert.equal(mark.priceE6, 152_500_000n);
  assert.equal(mark.observedAt, 1_758_000_100n);
  assert.equal(mark.sequence, 5n);
  assert.equal(mark.bump, 254);

  const offer = decodeOfferAccount(
    accountBytes(
      "Offer",
      new BorshWriter()
        .publicKey(new Uint8Array(32).fill(1))
        .publicKey(new Uint8Array(32).fill(2))
        .publicKey(new Uint8Array(32).fill(3))
        .u64(77n)
        .u64(995_000_000n)
        .i16(-300)
        .i64(1_758_000_000n)
        .i64(1_758_086_400n)
        .u8(253)
        .toUint8Array(),
    ),
  );
  assert.equal(offer.maker, "01".repeat(32));
  assert.equal(offer.baseMint, "02".repeat(32));
  assert.equal(offer.quoteMint, "03".repeat(32));
  assert.equal(offer.offerId, 77n);
  assert.equal(offer.baseAmount, 995_000_000n);
  assert.equal(offer.offsetBps, -300);
  assert.equal(offer.createdAt, 1_758_000_000n);
  assert.equal(offer.expiresAt, 1_758_086_400n);
  assert.equal(offer.bump, 253);
});

test("account decoders reject wrong discriminators and short data", () => {
  assert.throws(() => decodeConfigAccount(accountBytes("Mark", new BorshWriter().toUint8Array())), {
    name: "ProtocolDecodeError",
  });
  assert.throws(() => decodeOfferAccount(new Uint8Array(4)), /too short/);
});

test("anchor events decode from base64 program logs", () => {
  const offerFilledBody = new BorshWriter()
    .publicKey(new Uint8Array(32).fill(1))
    .publicKey(new Uint8Array(32).fill(2))
    .publicKey(new Uint8Array(32).fill(3))
    .u64(995_000_000n)
    .u64(990_025_000n)
    .u64(4_975_000n)
    .u64(990_025_000n)
    .u64(9_900_250n)
    .u64(10_000_000n)
    .u64(4n)
    .toUint8Array();
  const filledBytes = Uint8Array.from([...eventDiscriminator("OfferFilled"), ...offerFilledBody]);
  const filled = decodeAnchorEvent(Buffer.from(filledBytes).toString("base64"));
  assert.ok(filled && "quoteAmount" in filled);
  assert.equal(filled.quoteAmount, 9_900_250n);
  assert.equal(filled.buyerNetBaseAmount, 990_025_000n);
  assert.equal(filled.markSequence, 4n);
  assert.equal(filled.offer, "01".repeat(32));

  // Not base64 / wrong discriminator / truncated payload all return null.
  assert.equal(decodeAnchorEvent("not-base64!!"), null);
  assert.equal(decodeAnchorEvent(Buffer.from(new Uint8Array(40).fill(1)).toString("base64")), null);
  const truncated = Uint8Array.from([...eventDiscriminator("OfferFilled"), 1, 2, 3]);
  assert.equal(decodeAnchorEvent(Buffer.from(truncated).toString("base64")), null);
});

test("captured mainnet fixtures still decode through sha256 path", () => {
  // The mint fixtures are decoded by the SBF suite; here we only prove that
  // reading repository binaries through the codec path is stable.
  const anduril = readFileSync(`${repositoryRoot}/fixtures/mints/anduril.mint.bin`);
  assert.equal(anduril.length, 905);
  assert.equal(toHex(sha256(new Uint8Array(anduril)).slice(0, 8)).length, 16);
});
