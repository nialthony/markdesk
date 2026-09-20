import {
  applyUiMultiplierAsProgram,
  calculateGrossDepositForBuyerNetRaw,
  calculateQuoteRawForScaledAmount,
  calculateTransferFeeRaw,
  encodeCancelOffer,
  encodeCreateOffer,
  encodeFillOffer,
  MARKDESK_LIMITS,
} from "@markdesk/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getTransferFeeAmount,
  unpackAccount,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  configAddress,
  markAddress,
  offerAddress,
  offerVaultAddress,
  walletTokenAddress,
} from "./pdas";
import {
  eventsFromTransaction,
  type MintInsights,
  type OfferRead,
  type ProtocolEvent,
  type ProtocolRead,
  type TokenPosition,
} from "./read";

// Measured SBF compute for the extension-heavy fixture was 52,607 / 44,368 /
// 33,334 CU for create / fill / cancel. Budgets below keep generous headroom.
export const COMPUTE_UNIT_BUDGETS = {
  create: 150_000,
  fill: 120_000,
  cancel: 90_000,
} as const;

export type StageName =
  | "reading"
  | "ready"
  | "simulating"
  | "signing"
  | "sending"
  | "confirming"
  | "verifying"
  | "verified"
  | "mismatch"
  | "failed"
  | "unconfirmed";

export interface VerificationCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface TransactionSigner {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; blockers: string[] };

export type FlowOutcome =
  | {
      status: "verified";
      signature: TransactionSignature;
      slot: number | null;
      checks: VerificationCheck[];
      event: ProtocolEvent | null;
    }
  | {
      status: "mismatch";
      signature: TransactionSignature;
      slot: number | null;
      checks: VerificationCheck[];
    }
  | {
      status: "failed";
      stage: StageName;
      error: string;
      logs?: string[];
      signature?: TransactionSignature;
    }
  | { status: "unconfirmed"; signature: TransactionSignature; detail: string };

function scaledAmount(mint: MintInsights | null, raw: bigint): bigint {
  const multiplier = mint?.scaledUi?.activeMultiplier ?? 1;
  return applyUiMultiplierAsProgram(raw, multiplier);
}

function currentFeeTerms(mint: MintInsights | null) {
  return mint?.fee.current ?? { basisPoints: 0, maximumFeeRaw: 0n };
}

// ---------------------------------------------------------------------------
// Create (maker)
// ---------------------------------------------------------------------------

export interface CreateOfferPlan {
  offerId: bigint;
  offerAddress: string;
  vaultAddress: string;
  baseMintAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** Gross amount leaving the maker's account. */
  grossDepositRaw: bigint;
  /** Fee #1, withheld inside the vault on arrival. */
  inboundFeeRaw: bigint;
  /** Spendable vault credit; also the signed minimum-escrow bound. */
  vaultCreditRaw: bigint;
  /** Fee #2, withheld in the buyer's account at fill. */
  outboundFeeRaw: bigint;
  /** Base units the buyer can actually spend after both fee legs. */
  buyerNetRaw: bigint;
  scaledBuyerRaw: bigint;
  uiMultiplier: number;
  /** Quote value at the current mark, for review only. */
  quoteEstimateRaw: bigint;
  /** Signed bound: the program fails unless the vault credits at least this. */
  minimumEscrowedAmount: bigint;
  offsetBps: number;
  expiresAtSeconds: bigint;
  markPriceE6: bigint;
  markSequence: bigint;
  markAgeSeconds: number;
  preBaseAmountRaw: bigint | null;
  preBaseWithheldRaw: bigint | null;
  baseTokenProgram: string;
}

export function planCreateOffer(input: {
  read: ProtocolRead;
  maker: PublicKey;
  buyerNetTargetRaw: bigint;
  offsetBps: number;
  expiresAtSeconds: bigint;
  offerId: bigint;
}): PlanResult<CreateOfferPlan> {
  const { read, maker } = input;
  const blockers: string[] = [];
  const baseMint = read.baseMint;
  const mark = read.mark;
  const config = read.config;

  if (!read.programDeployed) blockers.push("MarkDesk program is not deployed on this cluster.");
  if (!config) blockers.push("Protocol config is not initialized on this cluster.");
  if (!baseMint) blockers.push("Base mint account was not found on this cluster.");
  if (!mark) blockers.push("No on-chain mark exists for this base mint yet.");
  if (mark && config && !mark.fresh) {
    blockers.push(
      `On-chain mark is stale (${mark.ageSeconds}s old, limit ${config.maxMarkAgeSeconds}s).`,
    );
  }
  if (!read.quoteMint) blockers.push("Configured quote mint was not found on this cluster.");
  if (baseMint?.pausable?.paused) blockers.push("Base mint is paused by its issuer.");
  if (baseMint?.transferHook?.active) {
    blockers.push("Base mint carries an active transfer hook; the program rejects it.");
  }
  if (baseMint?.defaultAccountState === "Frozen") {
    blockers.push("Base mint default account state is frozen.");
  }
  if (
    input.offsetBps < MARKDESK_LIMITS.minOffsetBps ||
    input.offsetBps > MARKDESK_LIMITS.maxOffsetBps
  ) {
    blockers.push(`Offset must stay within ±${MARKDESK_LIMITS.maxOffsetBps} bps.`);
  }
  const lifetime = Number(input.expiresAtSeconds - BigInt(read.nowSeconds));
  if (lifetime <= 0) blockers.push("Expiry must be in the future.");
  if (lifetime > MARKDESK_LIMITS.maxOfferLifetimeSeconds) {
    blockers.push("Expiry exceeds the 30-day maximum offer lifetime.");
  }
  if (input.buyerNetTargetRaw <= 0n) blockers.push("Buyer-net target must be positive.");

  const position = read.wallet?.base ?? null;
  if (!read.wallet) blockers.push("Connect a wallet to plan an offer.");
  if (position && position.amountRaw === null) {
    blockers.push("You have no base token account for this mint.");
  }

  const feeTerms = currentFeeTerms(baseMint);
  const grossDeposit = calculateGrossDepositForBuyerNetRaw(input.buyerNetTargetRaw, feeTerms);
  const inboundFee = calculateTransferFeeRaw(grossDeposit, feeTerms);
  const vaultCredit = grossDeposit - inboundFee;
  const outboundFee = calculateTransferFeeRaw(vaultCredit, feeTerms);
  const buyerNet = vaultCredit - outboundFee;

  if (position?.amountRaw != null && grossDeposit > position.amountRaw) {
    blockers.push("Insufficient base balance: the escrow needs the gross deposit, fees included.");
  }

  if (blockers.length > 0 || !baseMint || !mark || !read.quoteMint) {
    return { ok: false, blockers };
  }

  const scaled = scaledAmount(baseMint, buyerNet);
  const quoteEstimate = calculateQuoteRawForScaledAmount({
    scaledBaseAmountRaw: scaled,
    baseDecimals: baseMint.decimals,
    quoteDecimals: read.quoteMint.decimals,
    markPriceE6: mark.priceE6,
    offsetBps: input.offsetBps,
  });

  const offerKey = offerAddress(maker, input.offerId, read.cluster.programId);
  const vaultKey = offerVaultAddress(
    offerKey,
    new PublicKey(baseMint.address),
    new PublicKey(baseMint.tokenProgram),
  );

  return {
    ok: true,
    plan: {
      offerId: input.offerId,
      offerAddress: offerKey.toBase58(),
      vaultAddress: vaultKey.toBase58(),
      baseMintAddress: baseMint.address,
      baseDecimals: baseMint.decimals,
      quoteDecimals: read.quoteMint.decimals,
      grossDepositRaw: grossDeposit,
      inboundFeeRaw: inboundFee,
      vaultCreditRaw: vaultCredit,
      outboundFeeRaw: outboundFee,
      buyerNetRaw: buyerNet,
      scaledBuyerRaw: scaled,
      uiMultiplier: baseMint.scaledUi?.activeMultiplier ?? 1,
      quoteEstimateRaw: quoteEstimate,
      minimumEscrowedAmount: vaultCredit,
      offsetBps: input.offsetBps,
      expiresAtSeconds: input.expiresAtSeconds,
      markPriceE6: mark.priceE6,
      markSequence: mark.sequence,
      markAgeSeconds: mark.ageSeconds,
      preBaseAmountRaw: position?.amountRaw ?? null,
      preBaseWithheldRaw: position?.withheldRaw ?? null,
      baseTokenProgram: baseMint.tokenProgram,
    },
  };
}

/**
 * Account order must match the program's `CreateOffer` struct: maker, config,
 * base_mint, mark, offer, maker_base_account, vault, base_token_program,
 * associated_token_program, system_program.
 */
export function buildCreateOfferTransaction(input: {
  plan: CreateOfferPlan;
  maker: PublicKey;
  programId: PublicKey;
}): Transaction {
  const { plan, maker, programId } = input;
  const baseMint = new PublicKey(plan.baseMintAddress);
  const baseTokenProgram = new PublicKey(plan.baseTokenProgram);
  const offer = new PublicKey(plan.offerAddress);
  const vault = new PublicKey(plan.vaultAddress);
  const makerBase = walletTokenAddress(maker, baseMint, baseTokenProgram);

  const transaction = new Transaction();
  transaction.feePayer = maker;
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_BUDGETS.create }));
  transaction.add({
    keys: [
      { pubkey: maker, isSigner: true, isWritable: true },
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: markAddress(baseMint, programId), isSigner: false, isWritable: false },
      { pubkey: offer, isSigner: false, isWritable: true },
      { pubkey: makerBase, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(
      encodeCreateOffer({
        offerId: plan.offerId,
        grossBaseAmount: plan.grossDepositRaw,
        minimumEscrowedAmount: plan.minimumEscrowedAmount,
        offsetBps: plan.offsetBps,
        expiresAtSeconds: plan.expiresAtSeconds,
      }),
    ),
  });
  return transaction;
}

// ---------------------------------------------------------------------------
// Fill (taker)
// ---------------------------------------------------------------------------

export interface FillOfferPlan {
  offerAddress: string;
  vaultAddress: string;
  baseMintAddress: string;
  quoteMintAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** Vault spendable inventory; the gross amount leaving the vault. */
  grossBaseRaw: bigint;
  outboundFeeRaw: bigint;
  buyerNetRaw: bigint;
  scaledBuyerRaw: bigint;
  uiMultiplier: number;
  quoteAmountRaw: bigint;
  /** Signed bound: exact mark sequence priced at execution. */
  expectedMarkSequence: bigint;
  /** Signed bound: minimum net base the buyer must receive. */
  minimumBuyerNetRaw: bigint;
  /** Signed bound: maximum quote the buyer will pay. */
  maximumQuoteRaw: bigint;
  markPriceE6: bigint;
  markAgeSeconds: number;
  maker: string;
  offsetBps: number;
  expiresAtSeconds: bigint;
  preTakerBaseAmountRaw: bigint;
  preTakerBaseWithheldRaw: bigint;
  preTakerQuoteAmountRaw: bigint;
  preMakerQuoteAmountRaw: bigint | null;
  needsTakerBaseAta: boolean;
  needsMakerQuoteAta: boolean;
  baseTokenProgram: string;
  quoteTokenProgram: string;
}

export function planFillOffer(input: {
  read: OfferRead;
  taker: PublicKey;
}): PlanResult<FillOfferPlan> {
  const { read, taker } = input;
  const blockers: string[] = [];
  const baseMint = read.baseMint;
  const mark = read.mark;
  const config = read.config;

  if (!read.programDeployed) blockers.push("MarkDesk program is not deployed on this cluster.");
  if (!config) blockers.push("Protocol config is not initialized on this cluster.");
  if (!baseMint) blockers.push("Offer base mint was not found on this cluster.");
  if (!read.quoteMint) blockers.push("Configured quote mint was not found on this cluster.");
  if (!mark) blockers.push("No on-chain mark exists for this offer's base mint.");
  if (mark && config && !mark.fresh) {
    blockers.push(
      `On-chain mark is stale (${mark.ageSeconds}s old, limit ${config.maxMarkAgeSeconds}s).`,
    );
  }
  if (read.vault.amountRaw === null) {
    blockers.push("Offer vault is missing; the offer may already be settled.");
  } else if (read.vault.amountRaw !== read.offer.baseAmount) {
    blockers.push("Vault balance no longer matches the offer inventory; refuse to pay against it.");
  }
  if (read.offer.expiresAtSeconds <= BigInt(read.nowSeconds)) {
    blockers.push("This offer has expired.");
  }
  if (baseMint?.pausable?.paused) blockers.push("Base mint is paused by its issuer.");
  if (baseMint?.transferHook?.active) {
    blockers.push("Base mint carries an active transfer hook; the program rejects it.");
  }

  const takerBase = read.wallet?.base ?? null;
  const takerQuote = read.wallet?.quote ?? null;
  if (!read.wallet) blockers.push("Connect a wallet to plan a fill.");

  if (
    blockers.length > 0 ||
    !baseMint ||
    !mark ||
    !read.quoteMint ||
    read.vault.amountRaw === null
  ) {
    return { ok: false, blockers };
  }

  const grossBase = read.vault.amountRaw;
  const feeTerms = currentFeeTerms(baseMint);
  const outboundFee = calculateTransferFeeRaw(grossBase, feeTerms);
  const buyerNet = grossBase - outboundFee;
  if (buyerNet <= 0n) {
    return { ok: false, blockers: ["Transfer fee would consume the entire vault amount."] };
  }
  const scaled = scaledAmount(baseMint, buyerNet);
  const quote = calculateQuoteRawForScaledAmount({
    scaledBaseAmountRaw: scaled,
    baseDecimals: baseMint.decimals,
    quoteDecimals: read.quoteMint.decimals,
    markPriceE6: mark.priceE6,
    offsetBps: read.offer.offsetBps,
  });

  if (takerQuote?.amountRaw === null || (takerQuote?.amountRaw ?? 0n) < quote) {
    blockers.push("Insufficient quote balance for the signed maximum debit.");
  }

  if (blockers.length > 0) {
    return { ok: false, blockers };
  }

  return {
    ok: true,
    plan: {
      offerAddress: read.offer.address,
      vaultAddress: read.vault.address,
      baseMintAddress: baseMint.address,
      quoteMintAddress: read.quoteMint.address,
      baseDecimals: baseMint.decimals,
      quoteDecimals: read.quoteMint.decimals,
      grossBaseRaw: grossBase,
      outboundFeeRaw: outboundFee,
      buyerNetRaw: buyerNet,
      scaledBuyerRaw: scaled,
      uiMultiplier: baseMint.scaledUi?.activeMultiplier ?? 1,
      quoteAmountRaw: quote,
      expectedMarkSequence: mark.sequence,
      minimumBuyerNetRaw: buyerNet,
      maximumQuoteRaw: quote,
      markPriceE6: mark.priceE6,
      markAgeSeconds: mark.ageSeconds,
      maker: read.offer.maker,
      offsetBps: read.offer.offsetBps,
      expiresAtSeconds: read.offer.expiresAtSeconds,
      preTakerBaseAmountRaw: takerBase?.amountRaw ?? 0n,
      preTakerBaseWithheldRaw: takerBase?.withheldRaw ?? 0n,
      preTakerQuoteAmountRaw: takerQuote?.amountRaw ?? 0n,
      preMakerQuoteAmountRaw: read.makerQuote?.amountRaw ?? null,
      needsTakerBaseAta: (takerBase?.amountRaw ?? null) === null,
      needsMakerQuoteAta: (read.makerQuote?.amountRaw ?? null) === null,
      baseTokenProgram: baseMint.tokenProgram,
      quoteTokenProgram: read.quoteMint.tokenProgram,
    },
  };
}

/**
 * Account order must match the program's `FillOffer` struct: taker, maker,
 * config, mark, offer, base_mint, quote_mint, vault, taker_base_account,
 * taker_quote_account, maker_quote_account, base_token_program,
 * quote_token_program. Missing taker/maker token accounts are created
 * idempotently in the same atomic transaction.
 */
export function buildFillOfferTransaction(input: {
  plan: FillOfferPlan;
  taker: PublicKey;
  programId: PublicKey;
}): Transaction {
  const { plan, taker, programId } = input;
  const baseMint = new PublicKey(plan.baseMintAddress);
  const quoteMint = new PublicKey(plan.quoteMintAddress);
  const baseTokenProgram = new PublicKey(plan.baseTokenProgram);
  const quoteTokenProgram = new PublicKey(plan.quoteTokenProgram);
  const offer = new PublicKey(plan.offerAddress);
  const vault = new PublicKey(plan.vaultAddress);
  const maker = new PublicKey(plan.maker);

  const takerBase = walletTokenAddress(taker, baseMint, baseTokenProgram);
  const takerQuote = walletTokenAddress(taker, quoteMint, quoteTokenProgram);
  const makerQuote = walletTokenAddress(maker, quoteMint, quoteTokenProgram);

  const transaction = new Transaction();
  transaction.feePayer = taker;
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_BUDGETS.fill }));

  if (plan.needsTakerBaseAta) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        taker,
        takerBase,
        taker,
        baseMint,
        baseTokenProgram,
      ),
    );
  }
  if (plan.needsMakerQuoteAta) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        taker,
        makerQuote,
        maker,
        quoteMint,
        quoteTokenProgram,
      ),
    );
  }

  transaction.add({
    keys: [
      { pubkey: taker, isSigner: true, isWritable: true },
      { pubkey: maker, isSigner: false, isWritable: true },
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: markAddress(baseMint, programId), isSigner: false, isWritable: false },
      { pubkey: offer, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: takerBase, isSigner: false, isWritable: true },
      { pubkey: takerQuote, isSigner: false, isWritable: true },
      { pubkey: makerQuote, isSigner: false, isWritable: true },
      { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
      { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(
      encodeFillOffer({
        expectedMarkSequence: plan.expectedMarkSequence,
        minimumBuyerNetAmount: plan.minimumBuyerNetRaw,
        maximumQuoteAmount: plan.maximumQuoteRaw,
      }),
    ),
  });
  return transaction;
}

// ---------------------------------------------------------------------------
// Cancel (maker)
// ---------------------------------------------------------------------------

export interface CancelOfferPlan {
  offerAddress: string;
  vaultAddress: string;
  baseMintAddress: string;
  baseDecimals: number;
  grossReturnRaw: bigint;
  returnFeeRaw: bigint;
  netReturnRaw: bigint;
  /** Signed bound: minimum net base returned to the maker. */
  minimumReturnRaw: bigint;
  preMakerBaseAmountRaw: bigint;
  preMakerBaseWithheldRaw: bigint;
  baseTokenProgram: string;
  offsetBps: number;
  offerId: bigint;
  expiresAtSeconds: bigint;
}

export function planCancelOffer(input: {
  read: OfferRead;
  maker: PublicKey;
}): PlanResult<CancelOfferPlan> {
  const { read, maker } = input;
  const blockers: string[] = [];
  const baseMint = read.baseMint;

  if (!read.programDeployed) blockers.push("MarkDesk program is not deployed on this cluster.");
  if (read.offer.maker !== maker.toBase58()) {
    blockers.push("Only the offer's maker can cancel this offer.");
  }
  if (!baseMint) blockers.push("Offer base mint was not found on this cluster.");
  if (read.vault.amountRaw === null) {
    blockers.push("Offer vault is missing; the offer may already be settled.");
  }

  if (blockers.length > 0 || !baseMint || read.vault.amountRaw === null) {
    return { ok: false, blockers };
  }

  const grossReturn = read.vault.amountRaw;
  const feeTerms = currentFeeTerms(baseMint);
  const returnFee = calculateTransferFeeRaw(grossReturn, feeTerms);
  const netReturn = grossReturn - returnFee;

  const position = read.wallet?.base ?? null;
  if (!read.wallet) blockers.push("Connect a wallet to plan a cancellation.");
  if (position && position.amountRaw === null) {
    blockers.push("You have no base token account to receive the cancellation.");
  }

  if (blockers.length > 0) {
    return { ok: false, blockers };
  }

  return {
    ok: true,
    plan: {
      offerAddress: read.offer.address,
      vaultAddress: read.vault.address,
      baseMintAddress: read.offer.baseMint,
      baseDecimals: baseMint.decimals,
      grossReturnRaw: grossReturn,
      returnFeeRaw: returnFee,
      netReturnRaw: netReturn,
      minimumReturnRaw: netReturn,
      preMakerBaseAmountRaw: position?.amountRaw ?? 0n,
      preMakerBaseWithheldRaw: position?.withheldRaw ?? 0n,
      baseTokenProgram: baseMint.tokenProgram,
      offsetBps: read.offer.offsetBps,
      offerId: read.offer.offerId,
      expiresAtSeconds: read.offer.expiresAtSeconds,
    },
  };
}

/**
 * Account order must match the program's `CancelOffer` struct: maker, offer,
 * base_mint, vault, maker_base_account, base_token_program.
 */
export function buildCancelOfferTransaction(input: {
  plan: CancelOfferPlan;
  maker: PublicKey;
  programId: PublicKey;
}): Transaction {
  const { plan, maker, programId } = input;
  const baseMint = new PublicKey(plan.baseMintAddress);
  const baseTokenProgram = new PublicKey(plan.baseTokenProgram);
  const offer = new PublicKey(plan.offerAddress);
  const vault = new PublicKey(plan.vaultAddress);
  const makerBase = walletTokenAddress(maker, baseMint, baseTokenProgram);

  const transaction = new Transaction();
  transaction.feePayer = maker;
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_BUDGETS.cancel }));
  transaction.add({
    keys: [
      { pubkey: maker, isSigner: true, isWritable: true },
      { pubkey: offer, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: makerBase, isSigner: false, isWritable: true },
      { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(encodeCancelOffer({ minimumReturnAmount: plan.minimumReturnRaw })),
  });
  return transaction;
}

// ---------------------------------------------------------------------------
// Execute: simulate → sign → send → blockheight-aware confirm
// ---------------------------------------------------------------------------

export interface ExecuteInput {
  connection: Connection;
  signer: TransactionSigner;
  transaction: Transaction;
  onStage?: (stage: StageName, detail?: string) => void;
}

/** Pulls the Anchor error line out of raw logs so the receipt stays readable. */
export function summarizeLogsError(fallback: string, logs: string[]): string {
  // Prefer the descriptive AnchorError line over the hex "custom program error".
  for (const needle of ["Error Code:", "custom program error"]) {
    for (const log of logs.slice().reverse()) {
      if (log.includes(needle)) {
        return log.replace(/^Program log: /, "");
      }
    }
  }
  return fallback;
}

export type SendResult =
  | {
      status: "confirmed";
      signature: TransactionSignature;
      slot: number | null;
      blockhash: string;
      lastValidBlockHeight: number;
    }
  | { status: "failed"; stage: StageName; error: string; logs?: string[]; signature?: string }
  | { status: "unconfirmed"; signature: TransactionSignature; detail: string };

export async function simulateSignSendConfirm(input: ExecuteInput): Promise<SendResult> {
  const { connection, signer, transaction, onStage } = input;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;

  onStage?.("simulating");
  // web3.js only accepts simulation config with versioned transactions, so
  // round-trip the unsigned legacy transaction through the wire format.
  const wire = VersionedTransaction.deserialize(
    transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
  );
  const simulation = await connection.simulateTransaction(wire, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (simulation.value.err !== null) {
    const logs = simulation.value.logs ?? [];
    return {
      status: "failed",
      stage: "simulating",
      error: summarizeLogsError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`, logs),
      logs,
    };
  }

  onStage?.("signing");
  let signed: Transaction;
  try {
    signed = await signer.signTransaction(transaction);
  } catch (error) {
    return {
      status: "failed",
      stage: "signing",
      error: error instanceof Error ? error.message : "The wallet refused to sign.",
    };
  }

  onStage?.("sending");
  let signature: TransactionSignature;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: "processed",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The RPC node rejected the transaction.";
    return {
      status: "failed",
      stage: "sending",
      error: summarizeLogsError(message, [...(simulation.value.logs ?? []), message]),
      logs: [...(simulation.value.logs ?? []), message],
    };
  }

  onStage?.("confirming");
  try {
    const confirmation = await connection.confirmTransaction(
      { blockhash, lastValidBlockHeight, signature },
      "confirmed",
    );
    if (confirmation.value.err) {
      const failed = await fetchConfirmedTransaction(connection, signature, 2);
      const logs = failed?.meta?.logMessages ?? [];
      return {
        status: "failed",
        stage: "confirming",
        error: summarizeLogsError(
          `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
          logs,
        ),
        logs,
        signature,
      };
    }
    return {
      status: "confirmed",
      signature,
      slot: confirmation.context.slot,
      blockhash,
      lastValidBlockHeight,
    };
  } catch (error) {
    return {
      status: "unconfirmed",
      signature,
      detail:
        error instanceof Error
          ? `Blockhash window closed before confirmation: ${error.message}`
          : "Confirmation timed out.",
    };
  }
}

/** Re-fetches a just-confirmed transaction, tolerating devnet explorer lag. */
export async function fetchConfirmedTransaction(
  connection: Connection,
  signature: TransactionSignature,
  attempts = 5,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

function allChecksPass(checks: VerificationCheck[]): boolean {
  return checks.every((check) => check.ok);
}

async function readPosition(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<TokenPosition> {
  const address = walletTokenAddress(owner, mint, tokenProgram);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return { address, tokenProgram, amountRaw: null, withheldRaw: null };
  const account = unpackAccount(address, info, tokenProgram);
  return {
    address,
    tokenProgram,
    amountRaw: account.amount,
    withheldRaw: getTransferFeeAmount(account)?.withheldAmount ?? 0n,
  };
}

export async function runCreateOfferFlow(input: {
  connection: Connection;
  clusterProgramId: PublicKey;
  signer: TransactionSigner;
  plan: CreateOfferPlan;
  onStage?: (stage: StageName, detail?: string) => void;
}): Promise<FlowOutcome> {
  const { connection, signer, plan, onStage } = input;
  const transaction = buildCreateOfferTransaction({
    plan,
    maker: signer.publicKey,
    programId: input.clusterProgramId,
  });

  const sent = await simulateSignSendConfirm({ connection, signer, transaction, onStage });
  if (sent.status !== "confirmed") return sent;

  onStage?.("verifying");
  const response = await fetchConfirmedTransaction(connection, sent.signature);
  const events = eventsFromTransaction(response);
  const event = events.find((candidate) => "escrowedAmount" in candidate) ?? null;

  const offerInfo = await connection.getAccountInfo(new PublicKey(plan.offerAddress), "confirmed");
  const vaultInfo = await connection.getAccountInfo(new PublicKey(plan.vaultAddress), "confirmed");
  const makerBase = await readPosition(
    connection,
    signer.publicKey,
    new PublicKey(plan.baseMintAddress),
    new PublicKey(plan.baseTokenProgram),
  );

  const checks: VerificationCheck[] = [];
  checks.push(
    offerInfo !== null
      ? { label: "Offer PDA exists", ok: true, detail: plan.offerAddress }
      : { label: "Offer PDA exists", ok: false, detail: "Account not found after confirmation." },
  );

  if (offerInfo) {
    const { decodeOfferAccount } = await import("@markdesk/core");
    const decoded = decodeOfferAccount(Buffer.from(offerInfo.data));
    const matches =
      decoded.baseAmount === plan.vaultCreditRaw &&
      decoded.offsetBps === plan.offsetBps &&
      decoded.expiresAt === plan.expiresAtSeconds &&
      decoded.offerId === plan.offerId;
    checks.push({
      label: "Offer records the escrowed inventory",
      ok: matches,
      detail: matches
        ? `vault credit ${plan.vaultCreditRaw.toString()} raw units`
        : `on-chain record diverged: ${decoded.baseAmount.toString()} raw units`,
    });
  }

  checks.push(
    vaultInfo
      ? { label: "Escrow vault holds the spendable credit", ok: true, detail: plan.vaultAddress }
      : {
          label: "Escrow vault holds the spendable credit",
          ok: false,
          detail: "Vault account missing after confirmation.",
        },
  );

  if (plan.preBaseAmountRaw !== null && makerBase.amountRaw !== null) {
    const expected = plan.preBaseAmountRaw - plan.grossDepositRaw;
    checks.push({
      label: "Maker balance debited by the gross deposit",
      ok: makerBase.amountRaw === expected,
      detail:
        makerBase.amountRaw === expected
          ? `-${plan.grossDepositRaw.toString()} raw units`
          : `expected ${expected.toString()}, found ${makerBase.amountRaw.toString()}`,
    });
  }

  if (event && "escrowedAmount" in event) {
    const matches =
      event.escrowedAmount === plan.vaultCreditRaw &&
      event.grossDepositAmount === plan.grossDepositRaw &&
      event.inboundTransferFee === plan.inboundFeeRaw;
    checks.push({
      label: "OfferCreated settlement event matches the plan",
      ok: matches,
      detail: matches
        ? `gross ${event.grossDepositAmount.toString()}, fee ${event.inboundTransferFee.toString()}, credit ${event.escrowedAmount.toString()}`
        : "Event values diverge from the signed plan.",
    });
  } else {
    checks.push({
      label: "OfferCreated settlement event found",
      ok: false,
      detail: "No Anchor event was decoded from the confirmed transaction.",
    });
  }

  if (allChecksPass(checks)) {
    onStage?.("verified");
    return { status: "verified", signature: sent.signature, slot: sent.slot, checks, event };
  }
  onStage?.("mismatch");
  return { status: "mismatch", signature: sent.signature, slot: sent.slot, checks };
}

export async function runFillOfferFlow(input: {
  connection: Connection;
  clusterProgramId: PublicKey;
  signer: TransactionSigner;
  plan: FillOfferPlan;
  onStage?: (stage: StageName, detail?: string) => void;
}): Promise<FlowOutcome> {
  const { connection, signer, plan, onStage } = input;
  const transaction = buildFillOfferTransaction({
    plan,
    taker: signer.publicKey,
    programId: input.clusterProgramId,
  });

  const sent = await simulateSignSendConfirm({ connection, signer, transaction, onStage });
  if (sent.status !== "confirmed") return sent;

  onStage?.("verifying");
  const response = await fetchConfirmedTransaction(connection, sent.signature);
  const events = eventsFromTransaction(response);
  const event = events.find((candidate) => "buyerNetBaseAmount" in candidate) ?? null;

  const [offerInfo, vaultInfo] = await connection.getMultipleAccountsInfo(
    [new PublicKey(plan.offerAddress), new PublicKey(plan.vaultAddress)],
    "confirmed",
  );
  const taker = signer.publicKey;
  const takerBase = await readPosition(
    connection,
    taker,
    new PublicKey(plan.baseMintAddress),
    new PublicKey(plan.baseTokenProgram),
  );
  const takerQuote = await readPosition(
    connection,
    taker,
    new PublicKey(plan.quoteMintAddress),
    new PublicKey(plan.quoteTokenProgram),
  );
  const makerQuote = await readPosition(
    connection,
    new PublicKey(plan.maker),
    new PublicKey(plan.quoteMintAddress),
    new PublicKey(plan.quoteTokenProgram),
  );

  const checks: VerificationCheck[] = [
    {
      label: "Offer PDA closed",
      ok: offerInfo === null,
      detail: offerInfo === null ? "rent returned to the maker" : "Offer account still exists.",
    },
    {
      label: "Escrow vault closed",
      ok: vaultInfo === null,
      detail: vaultInfo === null ? "empty vault closed" : "Vault account still exists.",
    },
  ];

  if (takerBase.amountRaw !== null) {
    const expected = plan.preTakerBaseAmountRaw + plan.buyerNetRaw;
    checks.push({
      label: "Buyer credited the net base amount",
      ok: takerBase.amountRaw === expected,
      detail:
        takerBase.amountRaw === expected
          ? `+${plan.buyerNetRaw.toString()} raw units`
          : `expected ${expected.toString()}, found ${takerBase.amountRaw.toString()}`,
    });
    if (takerBase.withheldRaw !== null) {
      const expectedWithheld = plan.preTakerBaseWithheldRaw + plan.outboundFeeRaw;
      checks.push({
        label: "Outbound transfer fee withheld in the buyer account",
        ok: takerBase.withheldRaw === expectedWithheld,
        detail:
          takerBase.withheldRaw === expectedWithheld
            ? `+${plan.outboundFeeRaw.toString()} raw units withheld`
            : `expected ${expectedWithheld.toString()} withheld, found ${takerBase.withheldRaw.toString()}`,
      });
    }
  }

  if (takerQuote.amountRaw !== null) {
    const expected = plan.preTakerQuoteAmountRaw - plan.quoteAmountRaw;
    checks.push({
      label: "Quote debited exactly the signed maximum",
      ok: takerQuote.amountRaw === expected,
      detail:
        takerQuote.amountRaw === expected
          ? `-${plan.quoteAmountRaw.toString()} raw units`
          : `expected ${expected.toString()}, found ${takerQuote.amountRaw.toString()}`,
    });
  }

  if (makerQuote.amountRaw !== null) {
    const pre = plan.preMakerQuoteAmountRaw ?? 0n;
    const expected = pre + plan.quoteAmountRaw;
    checks.push({
      label: "Maker received the full quote payment",
      ok: makerQuote.amountRaw === expected,
      detail:
        makerQuote.amountRaw === expected
          ? `+${plan.quoteAmountRaw.toString()} raw units`
          : `expected ${expected.toString()}, found ${makerQuote.amountRaw.toString()}`,
    });
  }

  if (event && "buyerNetBaseAmount" in event) {
    const matches =
      event.buyerNetBaseAmount === plan.buyerNetRaw &&
      event.outboundTransferFee === plan.outboundFeeRaw &&
      event.scaledQuoteBaseAmount === plan.scaledBuyerRaw &&
      event.quoteAmount === plan.quoteAmountRaw &&
      event.markSequence === plan.expectedMarkSequence;
    checks.push({
      label: "OfferFilled settlement event matches the signed bounds",
      ok: matches,
      detail: matches
        ? `buyer net ${event.buyerNetBaseAmount.toString()}, quote ${event.quoteAmount.toString()}, mark sequence ${event.markSequence.toString()}`
        : "Event values diverge from the signed plan.",
    });
  } else {
    checks.push({
      label: "OfferFilled settlement event found",
      ok: false,
      detail: "No Anchor event was decoded from the confirmed transaction.",
    });
  }

  if (allChecksPass(checks)) {
    onStage?.("verified");
    return { status: "verified", signature: sent.signature, slot: sent.slot, checks, event };
  }
  onStage?.("mismatch");
  return { status: "mismatch", signature: sent.signature, slot: sent.slot, checks };
}

export async function runCancelOfferFlow(input: {
  connection: Connection;
  clusterProgramId: PublicKey;
  signer: TransactionSigner;
  plan: CancelOfferPlan;
  onStage?: (stage: StageName, detail?: string) => void;
}): Promise<FlowOutcome> {
  const { connection, signer, plan, onStage } = input;
  const transaction = buildCancelOfferTransaction({
    plan,
    maker: signer.publicKey,
    programId: input.clusterProgramId,
  });

  const sent = await simulateSignSendConfirm({ connection, signer, transaction, onStage });
  if (sent.status !== "confirmed") return sent;

  onStage?.("verifying");
  const response = await fetchConfirmedTransaction(connection, sent.signature);
  const events = eventsFromTransaction(response);
  const event = events.find((candidate) => "makerNetReturnAmount" in candidate) ?? null;

  const [offerInfo, vaultInfo] = await connection.getMultipleAccountsInfo(
    [new PublicKey(plan.offerAddress), new PublicKey(plan.vaultAddress)],
    "confirmed",
  );
  const makerBase = await readPosition(
    connection,
    signer.publicKey,
    new PublicKey(plan.baseMintAddress),
    new PublicKey(plan.baseTokenProgram),
  );

  const checks: VerificationCheck[] = [
    {
      label: "Offer PDA closed",
      ok: offerInfo === null,
      detail: offerInfo === null ? "rent returned to the maker" : "Offer account still exists.",
    },
    {
      label: "Escrow vault closed",
      ok: vaultInfo === null,
      detail: vaultInfo === null ? "empty vault closed" : "Vault account still exists.",
    },
  ];

  if (makerBase.amountRaw !== null) {
    const expected = plan.preMakerBaseAmountRaw + plan.netReturnRaw;
    checks.push({
      label: "Maker credited the net return",
      ok: makerBase.amountRaw === expected,
      detail:
        makerBase.amountRaw === expected
          ? `+${plan.netReturnRaw.toString()} raw units`
          : `expected ${expected.toString()}, found ${makerBase.amountRaw.toString()}`,
    });
    if (makerBase.withheldRaw !== null) {
      const expectedWithheld = plan.preMakerBaseWithheldRaw + plan.returnFeeRaw;
      checks.push({
        label: "Return transfer fee withheld in the maker account",
        ok: makerBase.withheldRaw === expectedWithheld,
        detail:
          makerBase.withheldRaw === expectedWithheld
            ? `+${plan.returnFeeRaw.toString()} raw units withheld`
            : `expected ${expectedWithheld.toString()} withheld, found ${makerBase.withheldRaw.toString()}`,
      });
    }
  }

  if (event && "makerNetReturnAmount" in event) {
    const matches =
      event.makerNetReturnAmount === plan.netReturnRaw &&
      event.returnTransferFee === plan.returnFeeRaw &&
      event.grossReturnAmount === plan.grossReturnRaw;
    checks.push({
      label: "OfferCancelled settlement event matches the plan",
      ok: matches,
      detail: matches
        ? `gross ${event.grossReturnAmount.toString()}, fee ${event.returnTransferFee.toString()}, net ${event.makerNetReturnAmount.toString()}`
        : "Event values diverge from the signed plan.",
    });
  } else {
    checks.push({
      label: "OfferCancelled settlement event found",
      ok: false,
      detail: "No Anchor event was decoded from the confirmed transaction.",
    });
  }

  if (allChecksPass(checks)) {
    onStage?.("verified");
    return { status: "verified", signature: sent.signature, slot: sent.slot, checks, event };
  }
  onStage?.("mismatch");
  return { status: "mismatch", signature: sent.signature, slot: sent.slot, checks };
}
