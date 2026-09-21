/**
 * MarkDesk devnet two-wallet acceptance test.
 *
 * Runs create → fill and create → cancel end to end with two throwaway
 * wallets, using the exact same flow functions as the web console:
 * read-before-sign, simulate, signed bounds, blockheight-aware confirmation,
 * and balance/closure verification. Exits non-zero if any step is not fully
 * verified.
 *
 * Usage:
 *   npm run devnet:flow-check -- [--program <id>] [--rpc <url>] [--buyer-net 0.25]
 *
 * Reads var/state/devnet.json written by the bootstrap; flags override it.
 */

import { parseDecimalToRaw } from "@markdesk/core";
import { getMint, unpackAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  confirmTransactionWithPayer,
  ensureSolBalance,
  explorerTx,
  keypairSigner,
  loadOrCreateKeypair,
  parseDevnetArgs,
  readDevnetState,
  type DevnetState,
} from "./common";
import { buildFundWalletTransaction, buildPublishMarkTransaction, devnetMarkAddress } from "./ix";
import {
  planCancelOffer,
  planCreateOffer,
  planFillOffer,
  runCancelOfferFlow,
  runCreateOfferFlow,
  runFillOfferFlow,
} from "../../apps/web/lib/solana/flows";
import { readOfferState, readProtocolState } from "../../apps/web/lib/solana/read";
import { decodeMarkAccount } from "@markdesk/core";

interface StepResult {
  name: string;
  ok: boolean;
  signature: string | undefined;
  detail: string;
}

async function main(): Promise<void> {
  const args = parseDevnetArgs(process.argv.slice(2));
  const state = await readDevnetState();
  if (!state && (!args.programId || !args.baseMint || !args.quoteMint)) {
    console.error(
      "✗ No var/state/devnet.json found. Run `npm run devnet:bootstrap` first, or pass --program, --base-mint, and --quote-mint.",
    );
    process.exit(1);
  }
  const resolved: DevnetState = state ?? {
    cluster: "devnet",
    programId: args.programId.toBase58(),
    baseMint: args.baseMint!.toBase58(),
    baseSymbol: "SYN",
    baseDecimals: 9,
    quoteMint: args.quoteMint!.toBase58(),
    quoteDecimals: 6,
    configAddress: "",
    publisher: "",
    payer: "",
    generatedAt: new Date().toISOString(),
  };

  const programId = args.programId;
  const baseMint = args.baseMint ?? new PublicKey(resolved.baseMint);
  const quoteMint = args.quoteMint ?? new PublicKey(resolved.quoteMint);

  const connection = new Connection(args.rpcUrl, "confirmed");
  let programInfo;
  try {
    programInfo = await connection.getAccountInfo(programId, "confirmed");
  } catch (error) {
    console.error(
      `✗ Cannot reach RPC ${args.rpcUrl} (${error instanceof Error ? error.message : error}).`,
    );
    process.exit(1);
  }
  if (!programInfo || !programInfo.executable) {
    console.error(`✗ Program ${programId.toBase58()} is not deployed on ${args.rpcUrl}.`);
    process.exit(1);
  }

  const payer = await loadOrCreateKeypair("markdesk-payer");
  const publisher = await loadOrCreateKeypair("markdesk-publisher");
  const maker = await loadOrCreateKeypair("devnet-maker");
  const taker = await loadOrCreateKeypair("devnet-taker");
  console.log(`· maker  ${maker.keypair.publicKey.toBase58()}`);
  console.log(`· taker  ${taker.keypair.publicKey.toBase58()}`);

  await ensureSolBalance(connection, maker.keypair.publicKey, 150_000_000n, payer.keypair);
  await ensureSolBalance(connection, taker.keypair.publicKey, 150_000_000n, payer.keypair);
  await ensureSolBalance(connection, publisher.keypair.publicKey, 50_000_000n, payer.keypair);

  // Inventory top-ups so the run is repeatable.
  // Read the base mint's live decimals after confirming the program is reachable.
  const baseDecimals = (await getMint(connection, baseMint, "confirmed", TOKEN_2022_PROGRAM_ID))
    .decimals;
  const buyerNetRaw = parseDecimalToRaw(args.buyerNet, baseDecimals);
  async function topUp(owner: PublicKey, mint: PublicKey, targetRaw: bigint, label: string) {
    const ata = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    )[0];
    const info = await connection.getAccountInfo(ata, "confirmed");
    const current = info ? unpackAccount(ata, info, TOKEN_2022_PROGRAM_ID).amount : 0n;
    if (current >= targetRaw) return;
    const transaction = buildFundWalletTransaction({
      payer: payer.keypair.publicKey,
      mintAuthority: payer.keypair.publicKey,
      owner,
      mint,
      amountRaw: targetRaw - current,
    });
    transaction.feePayer = payer.keypair.publicKey;
    await confirmTransactionWithPayer(connection, transaction, [payer.keypair]);
    console.log(`· Topped up ${label}`);
  }
  // Rough gross-up headroom: two creates plus fee legs.
  await topUp(maker.keypair.publicKey, baseMint, buyerNetRaw * 4n, "maker base");
  await topUp(taker.keypair.publicKey, quoteMint, 100n * 10n ** 6n, "taker quote");

  // Fresh mark right before execution (marks go stale after 300s).
  const markKey = devnetMarkAddress(baseMint, programId);
  const markInfo = await connection.getAccountInfo(markKey, "confirmed");
  if (!markInfo) {
    console.error("✗ No mark exists for the base mint; run the bootstrap first.");
    process.exit(1);
  }
  const previous = decodeMarkAccount(Buffer.from(markInfo.data));
  const priceE6 = previous.priceE6;
  const publishTransaction = buildPublishMarkTransaction({
    publisher: publisher.keypair.publicKey,
    programId,
    baseMint,
    priceE6,
    observedAtSeconds: BigInt(Math.floor(Date.now() / 1000)),
    sequence: previous.sequence + 1n,
  });
  const publishSignature = await confirmTransactionWithPayer(connection, publishTransaction, [
    publisher.keypair,
  ]);
  console.log(`· Fresh mark seq ${previous.sequence + 1n} — ${explorerTx(publishSignature)}`);

  const results: StepResult[] = [];

  // ---- Step 1: maker creates the offer ------------------------------------
  const makerSigner = keypairSigner(maker.keypair);
  const createRead = await readProtocolState({
    connection,
    cluster: {
      name: "devnet",
      label: "Devnet",
      endpoint: args.rpcUrl,
      explorerQuery: "?cluster=devnet",
      programId,
      requiresLocalRpc: false,
    },
    baseMint,
    wallet: maker.keypair.publicKey,
  });
  const createPlan = planCreateOffer({
    read: createRead,
    maker: maker.keypair.publicKey,
    buyerNetTargetRaw: buyerNetRaw,
    offsetBps: -300,
    expiresAtSeconds: BigInt(createRead.nowSeconds + 3_600 + 60),
    offerId: BigInt(Date.now()) * 1_000n,
  });
  if (!createPlan.ok) {
    console.error("✗ Create blocked: " + createPlan.blockers.join(" | "));
    process.exit(1);
  }
  console.log(
    `· Create: gross ${createPlan.plan.grossDepositRaw.toString()} raw → vault ${createPlan.plan.vaultCreditRaw.toString()} → buyer net ${createPlan.plan.buyerNetRaw.toString()} → quote ~${createPlan.plan.quoteEstimateRaw.toString()}`,
  );
  const createOutcome = await runCreateOfferFlow({
    connection,
    clusterProgramId: programId,
    signer: makerSigner,
    plan: createPlan.plan,
  });
  results.push(record("create_offer", createOutcome.status, createOutcome));

  // ---- Step 2: taker fills it ---------------------------------------------
  const takerSigner = keypairSigner(taker.keypair);
  const offerKey = new PublicKey(createPlan.plan.offerAddress);
  const fillRead = await readOfferState({
    connection,
    cluster: createRead.cluster,
    offer: offerKey,
    wallet: taker.keypair.publicKey,
  });
  if (!fillRead) {
    console.error("✗ Offer account missing after a verified create.");
    process.exit(1);
  }
  const fillPlan = planFillOffer({ read: fillRead, taker: taker.keypair.publicKey });
  if (!fillPlan.ok) {
    console.error("✗ Fill blocked: " + fillPlan.blockers.join(" | "));
    process.exit(1);
  }
  const fillOutcome = await runFillOfferFlow({
    connection,
    clusterProgramId: programId,
    signer: takerSigner,
    plan: fillPlan.plan,
  });
  results.push(record("fill_offer", fillOutcome.status, fillOutcome));

  // ---- Step 3: maker creates a second offer, then cancels it ---------------
  const createRead2 = await readProtocolState({
    connection,
    cluster: createRead.cluster,
    baseMint,
    wallet: maker.keypair.publicKey,
  });
  const createPlan2 = planCreateOffer({
    read: createRead2,
    maker: maker.keypair.publicKey,
    buyerNetTargetRaw: buyerNetRaw,
    offsetBps: 0,
    expiresAtSeconds: BigInt(createRead2.nowSeconds + 3_600 + 60),
    offerId: BigInt(Date.now()) * 1_000n + 1n,
  });
  if (!createPlan2.ok) {
    console.error("✗ Second create blocked: " + createPlan2.blockers.join(" | "));
    process.exit(1);
  }
  const create2Outcome = await runCreateOfferFlow({
    connection,
    clusterProgramId: programId,
    signer: makerSigner,
    plan: createPlan2.plan,
  });
  results.push(record("create_offer #2", create2Outcome.status, create2Outcome));
  if (create2Outcome.status !== "verified") {
    finish(results);
  }

  const cancelRead = await readOfferState({
    connection,
    cluster: createRead.cluster,
    offer: new PublicKey(createPlan2.plan.offerAddress),
    wallet: maker.keypair.publicKey,
  });
  if (!cancelRead) {
    console.error("✗ Second offer missing after a verified create.");
    process.exit(1);
  }
  const cancelPlan = planCancelOffer({
    read: cancelRead,
    maker: maker.keypair.publicKey,
  });
  if (!cancelPlan.ok) {
    console.error("✗ Cancel blocked: " + cancelPlan.blockers.join(" | "));
    process.exit(1);
  }
  const cancelOutcome = await runCancelOfferFlow({
    connection,
    clusterProgramId: programId,
    signer: makerSigner,
    plan: cancelPlan.plan,
  });
  results.push(record("cancel_offer", cancelOutcome.status, cancelOutcome));

  finish(results);
}

type OutcomeShape =
  | { status: "verified"; signature: string; slot: number | null }
  | { status: "mismatch"; signature: string; slot: number | null }
  | { status: string; signature?: string };

function record(name: string, status: string, outcome: OutcomeShape): StepResult {
  const signature = "signature" in outcome ? outcome.signature : undefined;
  const detail =
    status === "verified"
      ? "verified on-chain"
      : status === "mismatch"
        ? "confirmed but verification failed"
        : status === "unconfirmed"
          ? "sent but not confirmed"
          : `failed at ${status}`;
  return { name, ok: status === "verified", signature, detail };
}

function finish(results: StepResult[]): never {
  console.log("");
  let ok = true;
  for (const result of results) {
    const icon = result.ok ? "✓" : "✗";
    const link = result.signature ? ` — ${explorerTx(result.signature)}` : "";
    console.log(`${icon} ${result.name}: ${result.detail}${link}`);
    if (!result.ok) ok = false;
  }
  console.log("");
  if (ok) {
    console.log("PASS: two-wallet create → fill → cancel fully verified on devnet.");
    console.log("     The read-only preview label can now be lifted (see docs/DEVNET_RUNBOOK.md).");
    process.exit(0);
  }
  console.error("FAIL: at least one step was not verified. Inspect the links above.");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`✗ Flow check failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
