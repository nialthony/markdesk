import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateQuoteRawForScaledAmount,
  encodeCreateOffer,
  encodeFillOffer,
  encodeCancelOffer,
  toHex,
} from "@markdesk/core";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildCancelOfferTransaction,
  buildCreateOfferTransaction,
  buildFillOfferTransaction,
  planCancelOffer,
  planCreateOffer,
  planFillOffer,
  summarizeLogsError,
} from "../lib/solana/flows";
import { configAddress, markAddress, offerAddress, offerVaultAddress } from "../lib/solana/pdas";
import type { ClusterConfig } from "../lib/solana/cluster";
import type { MintInsights, OfferRead, ProtocolRead } from "../lib/solana/read";
import { resolveCluster } from "../lib/solana/cluster";

const PROGRAM_ID = new PublicKey("7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk");
const BASE_MINT = new PublicKey("PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB");
const QUOTE_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const MAKER = Keypair.generate().publicKey;
const TAKER = Keypair.generate().publicKey;
const NOW_SECONDS = 1_760_000_000;

const cluster: ClusterConfig = {
  name: "devnet",
  label: "Devnet",
  endpoint: "https://api.devnet.solana.com",
  explorerQuery: "?cluster=devnet",
  programId: PROGRAM_ID,
  requiresLocalRpc: false,
};

function syntheticMint(overrides: Partial<MintInsights> = {}): MintInsights {
  return {
    address: BASE_MINT.toBase58(),
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    isToken2022: true,
    decimals: 9,
    supplyRaw: 11_805_861_417_523n,
    extensionNames: ["TransferFeeConfig"],
    fee: {
      current: { epoch: 1038n, basisPoints: 50, maximumFeeRaw: 2n ** 64n - 1n },
      scheduled: { epoch: 1039n, basisPoints: 100, maximumFeeRaw: 2n ** 64n - 1n },
      configAuthority: MAKER.toBase58(),
      withdrawWithheldAuthority: MAKER.toBase58(),
      withheldOnMintRaw: 0n,
    },
    scaledUi: null,
    pausable: { paused: false, authority: MAKER.toBase58() },
    transferHook: null,
    permanentDelegate: MAKER.toBase58(),
    defaultAccountState: "Initialized",
    mintAuthority: null,
    freezeAuthority: MAKER.toBase58(),
    ...overrides,
  };
}

function syntheticRead(overrides: Partial<ProtocolRead> = {}): ProtocolRead {
  return {
    readAtMs: Date.now(),
    cluster,
    programDeployed: true,
    config: {
      address: configAddress(PROGRAM_ID).toBase58(),
      publisher: MAKER.toBase58(),
      quoteMint: QUOTE_MINT.toBase58(),
      maxMarkAgeSeconds: 300,
    },
    mark: {
      address: markAddress(BASE_MINT, PROGRAM_ID).toBase58(),
      mint: BASE_MINT.toBase58(),
      priceE6: 10_000_000n,
      observedAtSeconds: BigInt(NOW_SECONDS - 30),
      sequence: 4n,
      ageSeconds: 30,
      fresh: true,
    },
    baseMint: syntheticMint(),
    quoteMint: {
      address: QUOTE_MINT.toBase58(),
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      decimals: 6,
    },
    wallet: {
      base: {
        address: PublicKey.default,
        tokenProgram: PublicKey.default,
        amountRaw: 5_000_000_000n,
        withheldRaw: 0n,
      },
      quote: null,
    },
    epoch: 1038n,
    nowSeconds: NOW_SECONDS,
    ...overrides,
  };
}

function syntheticOfferRead(overrides: Partial<OfferRead> = {}): OfferRead {
  return {
    readAtMs: Date.now(),
    cluster,
    programDeployed: true,
    offer: {
      address: offerAddress(MAKER, 77n, PROGRAM_ID).toBase58(),
      maker: MAKER.toBase58(),
      baseMint: BASE_MINT.toBase58(),
      quoteMint: QUOTE_MINT.toBase58(),
      offerId: 77n,
      baseAmount: 995_000_000n,
      offsetBps: -300,
      createdAtSeconds: BigInt(NOW_SECONDS - 60),
      expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    },
    vault: {
      address: offerVaultAddress(
        offerAddress(MAKER, 77n, PROGRAM_ID),
        BASE_MINT,
        new PublicKey(syntheticMint().tokenProgram),
      ).toBase58(),
      amountRaw: 995_000_000n,
      closed: false,
    },
    baseMint: syntheticMint(),
    config: syntheticRead().config,
    mark: syntheticRead().mark,
    quoteMint: syntheticRead().quoteMint,
    wallet: {
      base: {
        address: PublicKey.default,
        tokenProgram: PublicKey.default,
        amountRaw: null,
        withheldRaw: null,
      },
      quote: {
        address: PublicKey.default,
        tokenProgram: PublicKey.default,
        amountRaw: 50_000_000n,
        withheldRaw: 0n,
      },
    },
    makerQuote: null,
    epoch: 1038n,
    nowSeconds: NOW_SECONDS,
    ...overrides,
  };
}

test("cluster resolution defaults to devnet and honors overrides", () => {
  delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  delete process.env.NEXT_PUBLIC_MARKDESK_PROGRAM_ID;

  const devnet = resolveCluster();
  assert.equal(devnet.name, "devnet");
  assert.equal(devnet.endpoint, "https://api.devnet.solana.com");
  assert.equal(devnet.explorerQuery, "?cluster=devnet");
  assert.equal(devnet.programId.toBase58(), PROGRAM_ID.toBase58());

  process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
  const localnet = resolveCluster();
  assert.equal(localnet.name, "localnet");
  assert.equal(
    localnet.explorerQuery,
    `?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:8899")}`,
  );
  assert.ok(localnet.requiresLocalRpc);

  process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "";
  delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
});

test("offer PDAs are deterministic and id-sensitive", () => {
  const first = offerAddress(MAKER, 77n, PROGRAM_ID);
  assert.equal(first.toBase58(), offerAddress(MAKER, 77n, PROGRAM_ID).toBase58());
  assert.notEqual(first.toBase58(), offerAddress(MAKER, 78n, PROGRAM_ID).toBase58());
  assert.notEqual(first.toBase58(), offerAddress(TAKER, 77n, PROGRAM_ID).toBase58());
  // Little-endian encoding: 256 vs 0 differ in byte 1, not byte 7.
  assert.notEqual(
    offerAddress(MAKER, 0n, PROGRAM_ID).toBase58(),
    offerAddress(MAKER, 256n, PROGRAM_ID).toBase58(),
  );
});

test("create plan reproduces the SBF-validated fee vector", () => {
  const result = planCreateOffer({
    read: syntheticRead(),
    maker: MAKER,
    buyerNetTargetRaw: 990_025_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    offerId: 77n,
  });

  assert.ok(result.ok, result.ok ? "" : result.blockers.join("; "));
  const plan = result.plan;
  assert.equal(plan.grossDepositRaw, 1_000_000_000n);
  assert.equal(plan.inboundFeeRaw, 5_000_000n);
  assert.equal(plan.vaultCreditRaw, 995_000_000n);
  assert.equal(plan.outboundFeeRaw, 4_975_000n);
  assert.equal(plan.buyerNetRaw, 990_025_000n);
  assert.equal(plan.minimumEscrowedAmount, 995_000_000n);
  assert.equal(plan.markSequence, 4n);
  assert.equal(
    plan.quoteEstimateRaw,
    calculateQuoteRawForScaledAmount({
      scaledBaseAmountRaw: 990_025_000n,
      baseDecimals: 9,
      quoteDecimals: 6,
      markPriceE6: 10_000_000n,
      offsetBps: -300,
    }),
  );
  assert.equal(plan.quoteEstimateRaw, 9_603_243n);
});

test("create plan blocks on missing program, stale marks, and low balance", () => {
  const stale = planCreateOffer({
    read: syntheticRead({
      mark: {
        address: markAddress(BASE_MINT, PROGRAM_ID).toBase58(),
        mint: BASE_MINT.toBase58(),
        priceE6: 10_000_000n,
        observedAtSeconds: BigInt(NOW_SECONDS - 3_600),
        sequence: 4n,
        ageSeconds: 3_600,
        fresh: false,
      },
    }),
    maker: MAKER,
    buyerNetTargetRaw: 990_025_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    offerId: 1n,
  });
  assert.ok(!stale.ok);
  assert.ok(stale.blockers.some((line) => line.includes("stale")));

  const undeployed = planCreateOffer({
    read: syntheticRead({ programDeployed: false }),
    maker: MAKER,
    buyerNetTargetRaw: 990_025_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    offerId: 1n,
  });
  assert.ok(!undeployed.ok);
  assert.ok(undeployed.blockers.some((line) => line.includes("not deployed")));

  const poor = syntheticRead();
  poor.wallet = {
    base: {
      address: PublicKey.default,
      tokenProgram: PublicKey.default,
      amountRaw: 100n,
      withheldRaw: 0n,
    },
    quote: null,
  };
  const broke = planCreateOffer({
    read: poor,
    maker: MAKER,
    buyerNetTargetRaw: 990_025_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    offerId: 1n,
  });
  assert.ok(!broke.ok);
  assert.ok(broke.blockers.some((line) => line.includes("Insufficient base balance")));
});

test("fill plan prices the SBF-validated settlement vector", () => {
  const result = planFillOffer({ read: syntheticOfferRead(), taker: TAKER });
  assert.ok(result.ok, result.ok ? "" : result.blockers.join("; "));
  const plan = result.plan;

  assert.equal(plan.grossBaseRaw, 995_000_000n);
  assert.equal(plan.outboundFeeRaw, 4_975_000n);
  assert.equal(plan.buyerNetRaw, 990_025_000n);
  assert.equal(plan.quoteAmountRaw, 9_603_243n);
  assert.equal(plan.expectedMarkSequence, 4n);
  assert.equal(plan.minimumBuyerNetRaw, 990_025_000n);
  assert.equal(plan.maximumQuoteRaw, 9_603_243n);
  assert.equal(plan.needsMakerQuoteAta, true);
});

test("fill plan refuses vault inventory drift and expired offers", () => {
  const drifted = syntheticOfferRead();
  drifted.vault = { ...drifted.vault, amountRaw: 900_000_000n };
  const drift = planFillOffer({ read: drifted, taker: TAKER });
  assert.ok(!drift.ok);
  assert.ok(drift.blockers.some((line) => line.includes("no longer matches")));

  const expiredOffer = syntheticOfferRead();
  expiredOffer.offer = {
    ...expiredOffer.offer,
    expiresAtSeconds: BigInt(NOW_SECONDS - 1),
  };
  const expired = planFillOffer({ read: expiredOffer, taker: TAKER });
  assert.ok(!expired.ok);
  assert.ok(expired.blockers.some((line) => line.includes("expired")));
});

test("cancel plan mirrors the SBF-validated cancellation vector", () => {
  const read = syntheticOfferRead();
  read.wallet = {
    base: {
      address: PublicKey.default,
      tokenProgram: PublicKey.default,
      amountRaw: 1_000_000_000n,
      withheldRaw: 0n,
    },
    quote: read.wallet?.quote ?? null,
  };
  const result = planCancelOffer({ read, maker: MAKER });
  assert.ok(result.ok, result.ok ? "" : result.blockers.join("; "));
  assert.equal(result.plan.grossReturnRaw, 995_000_000n);
  assert.equal(result.plan.returnFeeRaw, 4_975_000n);
  assert.equal(result.plan.netReturnRaw, 990_025_000n);
  assert.equal(result.plan.minimumReturnRaw, 990_025_000n);

  const foreign = planCancelOffer({ read: syntheticOfferRead(), maker: TAKER });
  assert.ok(!foreign.ok);
  assert.ok(foreign.blockers.some((line) => line.includes("Only the offer's maker")));
});

test("create transaction matches the program's account order and payload", () => {
  const plan = planCreateOffer({
    read: syntheticRead(),
    maker: MAKER,
    buyerNetTargetRaw: 990_025_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
    offerId: 77n,
  });
  assert.ok(plan.ok);

  const tx = buildCreateOfferTransaction({ plan: plan.plan, maker: MAKER, programId: PROGRAM_ID });
  assert.equal(tx.instructions.length, 2);
  assert.equal(tx.feePayer?.toBase58(), MAKER.toBase58());
  assert.ok(tx.instructions[0]!.programId.equals(ComputeBudgetProgram.programId));

  const instruction = tx.instructions[1]!;
  assert.ok(instruction.programId.equals(PROGRAM_ID));
  assert.equal(instruction.keys.length, 10);
  assert.ok(instruction.keys[0]!.pubkey.equals(MAKER));
  assert.ok(instruction.keys[0]!.isSigner);
  assert.ok(instruction.keys[1]!.pubkey.equals(configAddress(PROGRAM_ID)));
  assert.ok(instruction.keys[2]!.pubkey.equals(BASE_MINT));
  assert.ok(instruction.keys[3]!.pubkey.equals(markAddress(BASE_MINT, PROGRAM_ID)));
  assert.ok(instruction.keys[4]!.pubkey.equals(new PublicKey(plan.plan.offerAddress)));
  assert.ok(instruction.keys[6]!.pubkey.equals(new PublicKey(plan.plan.vaultAddress)));
  assert.ok(instruction.keys[7]!.pubkey.equals(new PublicKey(syntheticMint().tokenProgram)));
  assert.ok(
    instruction.keys[8]!.pubkey.equals(
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    ),
  );
  assert.ok(instruction.keys[9]!.pubkey.equals(SystemProgram.programId));

  const expectedData = encodeCreateOffer({
    offerId: 77n,
    grossBaseAmount: 1_000_000_000n,
    minimumEscrowedAmount: 995_000_000n,
    offsetBps: -300,
    expiresAtSeconds: BigInt(NOW_SECONDS + 3600),
  });
  assert.equal(toHex(new Uint8Array(instruction.data)), toHex(expectedData));
});

test("fill transaction prepends idempotent ATA creation for missing accounts", () => {
  const plan = planFillOffer({ read: syntheticOfferRead(), taker: TAKER });
  assert.ok(plan.ok);
  const tx = buildFillOfferTransaction({ plan: plan.plan, taker: TAKER, programId: PROGRAM_ID });

  // Compute budget + taker base ATA + maker quote ATA + fill.
  assert.equal(tx.instructions.length, 4);
  assert.equal(tx.feePayer?.toBase58(), TAKER.toBase58());

  const fill = tx.instructions[3]!;
  assert.equal(fill.keys.length, 13);
  assert.ok(fill.keys[0]!.pubkey.equals(TAKER));
  assert.ok(fill.keys[0]!.isSigner);
  assert.ok(fill.keys[1]!.pubkey.equals(MAKER));
  assert.ok(fill.keys[1]!.isWritable);
  assert.ok(fill.keys[2]!.pubkey.equals(configAddress(PROGRAM_ID)));
  assert.ok(fill.keys[3]!.pubkey.equals(markAddress(BASE_MINT, PROGRAM_ID)));
  assert.ok(fill.keys[5]!.pubkey.equals(BASE_MINT));
  assert.ok(fill.keys[5]!.isWritable);
  assert.ok(fill.keys[6]!.pubkey.equals(QUOTE_MINT));
  assert.ok(!fill.keys[6]!.isWritable);
  assert.ok(fill.keys[12]!.pubkey.equals(new PublicKey(syntheticRead().quoteMint!.tokenProgram)));

  const expectedData = encodeFillOffer({
    expectedMarkSequence: 4n,
    minimumBuyerNetAmount: 990_025_000n,
    maximumQuoteAmount: 9_603_243n,
  });
  assert.equal(toHex(new Uint8Array(fill.data)), toHex(expectedData));

  const withoutAtaNeeds = { ...plan.plan, needsTakerBaseAta: false, needsMakerQuoteAta: false };
  const lean = buildFillOfferTransaction({
    plan: withoutAtaNeeds,
    taker: TAKER,
    programId: PROGRAM_ID,
  });
  assert.equal(lean.instructions.length, 2);
});

test("cancel transaction matches the program's account order", () => {
  const read = syntheticOfferRead();
  read.wallet = {
    base: {
      address: PublicKey.default,
      tokenProgram: PublicKey.default,
      amountRaw: 1_000_000_000n,
      withheldRaw: 0n,
    },
    quote: read.wallet?.quote ?? null,
  };
  const plan = planCancelOffer({ read, maker: MAKER });
  assert.ok(plan.ok);
  const tx = buildCancelOfferTransaction({ plan: plan.plan, maker: MAKER, programId: PROGRAM_ID });
  assert.equal(tx.instructions.length, 2);
  const cancel = tx.instructions[1]!;
  assert.equal(cancel.keys.length, 6);
  assert.ok(cancel.keys[0]!.pubkey.equals(MAKER));
  assert.ok(cancel.keys[0]!.isSigner);
  assert.ok(cancel.keys[1]!.pubkey.equals(new PublicKey(plan.plan.offerAddress)));
  assert.ok(cancel.keys[2]!.pubkey.equals(BASE_MINT));
  assert.ok(cancel.keys[3]!.pubkey.equals(new PublicKey(plan.plan.vaultAddress)));
  const expectedData = encodeCancelOffer({ minimumReturnAmount: 990_025_000n });
  assert.equal(toHex(new Uint8Array(cancel.data)), toHex(expectedData));
});

test("anchor log errors surface readably in receipts", () => {
  const logs = [
    "Program 7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk invoke [1]",
    "Program log: Instruction: FillOffer",
    "Program log: AnchorError occurred. Error Code: StaleMark. Error Number: 6010. Error Message: The mark is stale.",
    "Program 7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk failed: custom program error: 0x177a",
  ];
  const summary = summarizeLogsError("raw fallback", logs);
  assert.ok(summary.includes("Error Code: StaleMark"));
  assert.ok(!summary.startsWith("Program log: "));
  assert.equal(summarizeLogsError("raw fallback", ["nothing useful"]), "raw fallback");
});
