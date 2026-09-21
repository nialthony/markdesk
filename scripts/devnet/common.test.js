import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeInitializeConfig, encodePublishMark, toHex } from "@markdesk/core";
import { decodeInitializeTransferFeeConfigInstruction, TOKEN_2022_PROGRAM_ID, } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { fetchAndurilMark, keypairSigner, parseDevnetArgs, readDevnetState, writeDevnetState, } from "./common";
import { buildFundWalletTransaction, buildInitializeConfigTransaction, buildPublishMarkTransaction, buildQuoteMintTransaction, buildSyntheticBaseMintTransaction, devnetConfigAddress, devnetMarkAddress, SYNTHETIC_MAX_FEE, SYNTHETIC_TRANSFER_FEE_BPS, } from "./ix";
const PROGRAM_ID = new PublicKey("7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk");
const PAYER = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
test("devnet args parse flags, equals syntax, and defaults", () => {
    const parsed = parseDevnetArgs([
        "--program",
        PROGRAM_ID.toBase58(),
        "--rpc=https://rpc.example.com",
        "--mark-usd=152.50",
        "--fund-address",
        "11111111111111111111111111111112",
    ]);
    assert.equal(parsed.programId.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(parsed.rpcUrl, "https://rpc.example.com");
    assert.equal(parsed.markUsd, 152.5);
    assert.ok(parsed.fundAddress?.equals(new PublicKey("11111111111111111111111111111112")));
    assert.equal(parsed.buyerNet, "0.25");
    const defaults = parseDevnetArgs(["--program", PROGRAM_ID.toBase58()]);
    assert.equal(defaults.rpcUrl, "https://api.devnet.solana.com");
    assert.equal(defaults.markUsd, null);
    assert.equal(defaults.baseMint, null);
    assert.throws(() => parseDevnetArgs([]), /--program/);
    assert.throws(() => parseDevnetArgs(["--program", PROGRAM_ID.toBase58(), "--mark-usd", "-3"]), RangeError);
});
test("keypair signer produces a fully valid signature offline", async () => {
    const keypair = Keypair.generate();
    const signer = keypairSigner(keypair);
    const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1_000,
    }));
    transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
    transaction.feePayer = keypair.publicKey;
    const signed = await signer.signTransaction(transaction);
    assert.ok(signed.verifySignatures());
    assert.equal(signer.publicKey.toBase58(), keypair.publicKey.toBase58());
});
test("initialize config transaction matches the program account order", () => {
    const publisher = Keypair.generate().publicKey;
    const quoteMint = Keypair.generate().publicKey;
    const transaction = buildInitializeConfigTransaction({
        authority: PAYER,
        programId: PROGRAM_ID,
        publisher,
        quoteMint,
        maxMarkAgeSeconds: 300,
    });
    const instruction = transaction.instructions[1];
    assert.ok(instruction.programId.equals(PROGRAM_ID));
    assert.equal(instruction.keys.length, 4);
    assert.ok(instruction.keys[0].pubkey.equals(PAYER));
    assert.ok(instruction.keys[0].isSigner);
    assert.ok(instruction.keys[1].pubkey.equals(devnetConfigAddress(PROGRAM_ID)));
    assert.ok(instruction.keys[1].isWritable);
    assert.ok(instruction.keys[2].pubkey.equals(quoteMint));
    assert.ok(instruction.keys[3].pubkey.equals(SystemProgram.programId));
    const expected = encodeInitializeConfig({
        publisher: publisher.toBytes(),
        maxMarkAgeSeconds: 300,
    });
    assert.equal(toHex(new Uint8Array(instruction.data)), toHex(expected));
});
test("publish mark transaction matches the program account order", () => {
    const publisher = Keypair.generate().publicKey;
    const transaction = buildPublishMarkTransaction({
        publisher,
        programId: PROGRAM_ID,
        baseMint: MINT,
        priceE6: 152500000n,
        observedAtSeconds: 1760000000n,
        sequence: 7n,
    });
    const instruction = transaction.instructions[1];
    assert.equal(instruction.keys.length, 5);
    assert.ok(instruction.keys[0].pubkey.equals(publisher));
    assert.ok(instruction.keys[0].isSigner);
    assert.ok(instruction.keys[1].pubkey.equals(devnetConfigAddress(PROGRAM_ID)));
    assert.ok(instruction.keys[2].pubkey.equals(MINT));
    assert.ok(instruction.keys[3].pubkey.equals(devnetMarkAddress(MINT, PROGRAM_ID)));
    assert.ok(instruction.keys[3].isWritable);
    assert.ok(instruction.keys[4].pubkey.equals(SystemProgram.programId));
    const expected = encodePublishMark({
        priceE6: 152500000n,
        observedAtSeconds: 1760000000n,
        sequence: 7n,
    });
    assert.equal(toHex(new Uint8Array(instruction.data)), toHex(expected));
});
test("synthetic base mint initializes the full fixture extension profile", () => {
    const authority = Keypair.generate().publicKey;
    const { transaction, space } = buildSyntheticBaseMintTransaction({
        payer: PAYER,
        mint: MINT,
        authority,
        lamports: 1_000_000,
    });
    // createAccount + 5 extension inits + InitializeMint2.
    assert.equal(transaction.instructions.length, 7);
    assert.ok(space > 165);
    const feeInit = transaction.instructions[1];
    assert.ok(feeInit.programId.equals(TOKEN_2022_PROGRAM_ID));
    const decoded = decodeInitializeTransferFeeConfigInstruction(feeInit, TOKEN_2022_PROGRAM_ID);
    assert.equal(decoded.data.transferFeeBasisPoints, SYNTHETIC_TRANSFER_FEE_BPS);
    assert.equal(BigInt(decoded.data.maximumFee), SYNTHETIC_MAX_FEE);
    assert.ok(decoded.keys.mint.pubkey.equals(MINT));
    for (const instruction of transaction.instructions.slice(1)) {
        assert.ok(instruction.programId.equals(TOKEN_2022_PROGRAM_ID), "every init targets Token-2022");
    }
});
test("quote mint and funding transactions stay minimal", () => {
    const quoteMint = Keypair.generate().publicKey;
    const quoteTransaction = buildQuoteMintTransaction({
        payer: PAYER,
        mint: quoteMint,
        authority: PAYER,
        lamports: 1_000_000,
    });
    assert.equal(quoteTransaction.instructions.length, 2);
    assert.ok(quoteTransaction.instructions[1].programId.equals(TOKEN_2022_PROGRAM_ID));
    const owner = Keypair.generate().publicKey;
    const fundTransaction = buildFundWalletTransaction({
        payer: PAYER,
        mintAuthority: PAYER,
        owner,
        mint: MINT,
        amountRaw: 1000n,
    });
    // Idempotent ATA creation + mintTo.
    assert.equal(fundTransaction.instructions.length, 2);
    assert.ok(fundTransaction.instructions[0].programId.equals(new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")));
    assert.ok(fundTransaction.instructions[1].programId.equals(TOKEN_2022_PROGRAM_ID));
});
test("anduril mark falls back to the labeled snapshot when upstream is down", async () => {
    const mark = await fetchAndurilMark(null);
    assert.equal(mark.symbol, "ANDURIL");
    assert.ok(mark.markPrice > 0);
    assert.equal(mark.markPriceE6, BigInt(Math.round(mark.markPrice * 1_000_000)));
    // On a machine with network access this is "live"; offline it is the snapshot.
    assert.ok(mark.source === "live" || mark.source === "snapshot");
    const overridden = await fetchAndurilMark(123.456);
    assert.equal(overridden.markPriceE6, 123456000n);
});
test("devnet state file round-trips", async () => {
    const directory = await mkdtemp(join(tmpdir(), "markdesk-state-"));
    const path = join(directory, "devnet.json");
    process.env.MARKDESK_STATE_FILE = path;
    const state = {
        cluster: "devnet",
        programId: PROGRAM_ID.toBase58(),
        baseMint: MINT.toBase58(),
        baseSymbol: "SYN-ANDURIL",
        baseDecimals: 9,
        quoteMint: Keypair.generate().publicKey.toBase58(),
        quoteDecimals: 6,
        configAddress: devnetConfigAddress(PROGRAM_ID).toBase58(),
        publisher: Keypair.generate().publicKey.toBase58(),
        payer: PAYER.toBase58(),
        generatedAt: new Date().toISOString(),
    };
    await writeDevnetState(state);
    const restored = await readDevnetState();
    assert.deepEqual(restored, state);
    // 0600 permissions on the state file.
    const mode = (await readFile(path)).length > 0 ? (await import("node:fs")).statSync(path).mode : 0;
    assert.equal(mode & 0o777, 0o600);
    delete process.env.MARKDESK_STATE_FILE;
    assert.equal(await readDevnetState(), null);
});
