/**
 * MarkDesk devnet bootstrap.
 *
 * Idempotent: safe to re-run. Creates (or reuses) throwaway keypairs under
 * var/keys, a synthetic PreStocks-like Token-2022 base mint, a 6-decimal
 * quote mint, the protocol config, a fresh mark, and funded test wallets.
 *
 * Usage:
 *   npm run devnet:bootstrap -- --program <deployed-program-id> [options]
 * Options:
 *   --rpc <url>           RPC endpoint (default api.devnet.solana.com)
 *   --base-mint <pubkey>  reuse an existing base mint instead of the synthetic one
 *   --quote-mint <pubkey> use an existing quote mint (e.g. devnet USDC)
 *   --mark-usd <number>   override the ANDURIL mark price
 *   --fund-address <key>  mint test inventory to an extra wallet (e.g. Phantom)
 */
import { decodeConfigAccount, decodeMarkAccount, MARKDESK_PROGRAM_ID_PLACEHOLDER, } from "@markdesk/core";
import { getMint, unpackAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { confirmTransactionWithPayer, DEFAULT_DEVNET_RPC, ensureSolBalance, explorerAddress, fetchAndurilMark, loadOrCreateKeypair, parseDevnetArgs, readDevnetState, writeDevnetState, } from "./common";
import { buildFundWalletTransaction, buildInitializeConfigTransaction, buildPublishMarkTransaction, buildQuoteMintTransaction, buildSyntheticBaseMintTransaction, devnetConfigAddress, devnetMarkAddress, SYNTHETIC_BASE_DECIMALS, SYNTHETIC_BASE_MINT_SPACE, SYNTHETIC_QUOTE_DECIMALS, SYNTHETIC_QUOTE_MINT_SPACE, } from "./ix";
const MAX_MARK_AGE_SECONDS = 300;
async function sendPayer(connection, payer, transaction, extraSigners = []) {
    return confirmTransactionWithPayer(connection, transaction, [payer, ...extraSigners]);
}
async function main() {
    const args = parseDevnetArgs(process.argv.slice(2));
    if (args.programId.toBase58() === MARKDESK_PROGRAM_ID_PLACEHOLDER) {
        console.warn("Warning: --program is still the source placeholder. Pass the real program id after `anchor keys sync` and deployment.");
    }
    const connection = new Connection(args.rpcUrl, "confirmed");
    // 1. The program must already be deployed.
    let programInfo;
    try {
        programInfo = await connection.getAccountInfo(args.programId, "confirmed");
    }
    catch (error) {
        console.error(`✗ Cannot reach RPC ${args.rpcUrl} (${error instanceof Error ? error.message : error}).\n` +
            "  Check the URL or pass --rpc <url>.");
        process.exit(1);
    }
    if (!programInfo || !programInfo.executable) {
        console.error(`✗ MarkDesk program ${args.programId.toBase58()} is not deployed on ${args.rpcUrl}.\n` +
            "  Deploy first (see docs/DEVNET_RUNBOOK.md), then re-run bootstrap.");
        process.exit(1);
    }
    // 2. Keypairs (never committed; var/ is gitignored).
    const payer = await loadOrCreateKeypair("markdesk-payer");
    const publisher = await loadOrCreateKeypair("markdesk-publisher");
    const maker = await loadOrCreateKeypair("devnet-maker");
    const taker = await loadOrCreateKeypair("devnet-taker");
    const syntheticBase = await loadOrCreateKeypair("synthetic-base");
    const syntheticQuote = await loadOrCreateKeypair("synthetic-quote");
    for (const entry of [payer, publisher, maker, taker, syntheticBase, syntheticQuote]) {
        if (entry.created) {
            console.log(`· Created keypair ${entry.path} (back it up; it is gitignored)`);
        }
    }
    // Only the payer touches the faucet; everything else is sponsored from it.
    await ensureSolBalance(connection, payer.keypair.publicKey, 400000000n);
    await ensureSolBalance(connection, publisher.keypair.publicKey, 100000000n, payer.keypair);
    await ensureSolBalance(connection, maker.keypair.publicKey, 100000000n, payer.keypair);
    await ensureSolBalance(connection, taker.keypair.publicKey, 100000000n, payer.keypair);
    // 3. Base mint: explicit --base-mint, existing synthetic, or a fresh one.
    let baseMint;
    let baseDecimals = SYNTHETIC_BASE_DECIMALS;
    const state = await readDevnetState();
    if (args.baseMint) {
        baseMint = args.baseMint;
        baseDecimals = (await getMint(connection, baseMint, "confirmed", TOKEN_2022_PROGRAM_ID))
            .decimals;
        console.log(`· Using provided base mint ${baseMint.toBase58()} (${baseDecimals} decimals)`);
    }
    else {
        baseMint = syntheticBase.keypair.publicKey;
        if (!(await connection.getAccountInfo(baseMint, "confirmed"))) {
            const transaction = buildSyntheticBaseMintTransaction({
                payer: payer.keypair.publicKey,
                mint: baseMint,
                authority: payer.keypair.publicKey,
                lamports: await connection.getMinimumBalanceForRentExemption(SYNTHETIC_BASE_MINT_SPACE),
            }).transaction;
            const signature = await sendPayer(connection, payer.keypair, transaction, [
                syntheticBase.keypair,
            ]);
            console.log(`· Created synthetic base mint ${baseMint.toBase58()} (Token-2022, 50 bps fee, delegate, pausable, scaled UI 1×) — ${explorerTx(signature)}`);
        }
        else {
            console.log(`· Reusing synthetic base mint ${baseMint.toBase58()}`);
        }
    }
    // 4. Quote mint: explicit --quote-mint or a fresh 6-decimal one.
    let quoteMint;
    if (args.quoteMint) {
        quoteMint = args.quoteMint;
        console.log(`· Using provided quote mint ${quoteMint.toBase58()}`);
    }
    else {
        quoteMint = syntheticQuote.keypair.publicKey;
        if (!(await connection.getAccountInfo(quoteMint, "confirmed"))) {
            const transaction = buildQuoteMintTransaction({
                payer: payer.keypair.publicKey,
                mint: quoteMint,
                authority: payer.keypair.publicKey,
                lamports: await connection.getMinimumBalanceForRentExemption(SYNTHETIC_QUOTE_MINT_SPACE),
            });
            const signature = await sendPayer(connection, payer.keypair, transaction, [
                syntheticQuote.keypair,
            ]);
            console.log(`· Created quote mint ${quoteMint.toBase58()} (6 decimals, no fee) — ${explorerTx(signature)}`);
        }
        else {
            console.log(`· Reusing quote mint ${quoteMint.toBase58()}`);
        }
    }
    // 5. Protocol config.
    const configKey = devnetConfigAddress(args.programId);
    const configInfo = await connection.getAccountInfo(configKey, "confirmed");
    if (!configInfo) {
        const transaction = buildInitializeConfigTransaction({
            authority: payer.keypair.publicKey,
            programId: args.programId,
            publisher: publisher.keypair.publicKey,
            quoteMint,
            maxMarkAgeSeconds: MAX_MARK_AGE_SECONDS,
        });
        const signature = await sendPayer(connection, payer.keypair, transaction);
        console.log(`· Initialized config ${configKey.toBase58()} (publisher ${publisher.keypair.publicKey.toBase58()}, max mark age ${MAX_MARK_AGE_SECONDS}s) — ${explorerTx(signature)}`);
    }
    else {
        const config = decodeConfigAccount(Buffer.from(configInfo.data));
        const configuredQuote = new PublicKey(Buffer.from(config.quoteMint, "hex"));
        if (!configuredQuote.equals(quoteMint)) {
            console.error(`✗ Config already exists with quote mint ${configuredQuote.toBase58()}.\n` +
                `  Re-run bootstrap with --quote-mint ${configuredQuote.toBase58()} (the config quote mint is immutable).`);
            process.exit(1);
        }
        console.log(`· Reusing config ${configKey.toBase58()}`);
    }
    // 6. Fresh mark for the base mint, priced at the official ANDURIL mark.
    const markKey = devnetMarkAddress(baseMint, args.programId);
    const markInfo = await connection.getAccountInfo(markKey, "confirmed");
    const sequence = markInfo ? decodeMarkAccount(Buffer.from(markInfo.data)).sequence + 1n : 1n;
    const mark = await fetchAndurilMark(args.markUsd);
    const observedAt = BigInt(Math.floor(Date.now() / 1000));
    const publishTransaction = buildPublishMarkTransaction({
        publisher: publisher.keypair.publicKey,
        programId: args.programId,
        baseMint,
        priceE6: mark.markPriceE6,
        observedAtSeconds: observedAt,
        sequence,
    });
    publishTransaction.feePayer = publisher.keypair.publicKey;
    const publishSignature = await confirmTransactionWithPayer(connection, publishTransaction, [
        publisher.keypair,
    ]);
    console.log(`· Published mark seq ${sequence} at $${mark.markPrice.toFixed(2)} (${mark.source} ANDURIL reference) — ${explorerTx(publishSignature)}`);
    // 7. Fund test wallets (idempotent top-ups).
    const mintRaw = (tokens, decimals) => BigInt(tokens * 10 ** decimals);
    const fund = async (owner, mint, tokens, decimals, label) => {
        const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
        const info = await connection.getAccountInfo(ata, "confirmed");
        const current = info ? unpackAccount(ata, info, TOKEN_2022_PROGRAM_ID).amount : 0n;
        const target = mintRaw(tokens, decimals);
        if (current >= target) {
            console.log(`· ${label} already holds ${current.toString()} raw units`);
            return;
        }
        const transaction = buildFundWalletTransaction({
            payer: payer.keypair.publicKey,
            mintAuthority: payer.keypair.publicKey,
            owner,
            mint,
            amountRaw: target - current,
        });
        const signature = await sendPayer(connection, payer.keypair, transaction);
        console.log(`· Funded ${label} to ${tokens} tokens — ${explorerTx(signature)}`);
    };
    await fund(maker.keypair.publicKey, baseMint, 10, baseDecimals, "maker (base)");
    await fund(taker.keypair.publicKey, quoteMint, 1_000, SYNTHETIC_QUOTE_DECIMALS, "taker (quote)");
    if (args.fundAddress) {
        await fund(args.fundAddress, baseMint, 10, baseDecimals, `extra wallet base ${args.fundAddress.toBase58()}`);
        await fund(args.fundAddress, quoteMint, 1_000, SYNTHETIC_QUOTE_DECIMALS, `extra wallet quote ${args.fundAddress.toBase58()}`);
    }
    // 8. Persist state and print the web app configuration.
    const devnetState = {
        cluster: "devnet",
        programId: args.programId.toBase58(),
        baseMint: baseMint.toBase58(),
        baseSymbol: "SYN-ANDURIL",
        baseDecimals,
        quoteMint: quoteMint.toBase58(),
        quoteDecimals: SYNTHETIC_QUOTE_DECIMALS,
        configAddress: configKey.toBase58(),
        publisher: publisher.keypair.publicKey.toBase58(),
        payer: payer.keypair.publicKey.toBase58(),
        generatedAt: new Date().toISOString(),
    };
    await writeDevnetState(devnetState);
    console.log("\n✓ Devnet bootstrap complete.\n");
    console.log("  Program : " + explorerAddress(args.programId.toBase58()));
    console.log("  Base    : " + explorerAddress(baseMint.toBase58()));
    console.log("  Quote   : " + explorerAddress(quoteMint.toBase58()));
    console.log("  Config  : " + explorerAddress(configKey.toBase58()));
    console.log("  Mark    : " + explorerAddress(markKey.toBase58()));
    console.log("\n  Put this in apps/web/.env.local and restart the dev server:\n");
    console.log(`  NEXT_PUBLIC_SOLANA_CLUSTER=devnet`);
    console.log(`  NEXT_PUBLIC_SOLANA_RPC_URL=${args.rpcUrl === DEFAULT_DEVNET_RPC ? DEFAULT_DEVNET_RPC : args.rpcUrl}`);
    console.log(`  NEXT_PUBLIC_MARKDESK_PROGRAM_ID=${args.programId.toBase58()}`);
    console.log(`  NEXT_PUBLIC_DEMO_BASE_MINT=${baseMint.toBase58()}`);
    console.log(`  NEXT_PUBLIC_DEMO_BASE_SYMBOL=SYN-ANDURIL`);
    console.log("\n  Then run the two-wallet acceptance test:");
    console.log("  npm run devnet:flow-check\n");
}
function explorerTx(signature) {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
main().catch((error) => {
    console.error(`✗ Bootstrap failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
