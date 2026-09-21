/**
 * Shared helpers for the MarkDesk devnet bootstrap and two-wallet flow check.
 *
 * Everything here is Node-only (the web app never imports this module). Keys
 * are created on demand under `var/keys` (gitignored) with mode 0600 and are
 * never committed; treat them as throwaway devnet fixtures.
 */
import { normalizePreStocks, PRESTOCKS_MINTS } from "@markdesk/core";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, } from "@solana/web3.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Devnet keys never enter git; override the directory with MARKDESK_KEYS_DIR. */
export function keysDirectory() {
    return process.env.MARKDESK_KEYS_DIR ?? resolve(REPOSITORY_ROOT, "var/keys");
}
export function stateFilePath() {
    return process.env.MARKDESK_STATE_FILE ?? resolve(REPOSITORY_ROOT, "var/state/devnet.json");
}
export async function loadOrCreateKeypair(name) {
    const path = resolve(keysDirectory(), `${name}.json`);
    try {
        const raw = JSON.parse(await readFile(path, "utf8"));
        return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), path, created: false };
    }
    catch {
        const keypair = Keypair.generate();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, { mode: 0o600 });
        return { keypair, path, created: true };
    }
}
/** A TransactionSigner backed by a local keypair instead of a wallet. */
export function keypairSigner(keypair) {
    return {
        publicKey: keypair.publicKey,
        signTransaction: async (transaction) => {
            transaction.partialSign(keypair);
            return transaction;
        },
    };
}
/**
 * Sends a transaction with an explicit fresh blockhash. web3.js may fill one
 * implicitly, but devnet latency makes the explicit path deterministic.
 */
export async function confirmTransactionWithPayer(connection, transaction, signers) {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    return sendAndConfirmTransaction(connection, transaction, signers, {
        commitment: "confirmed",
        maxRetries: 5,
    });
}
/**
 * Ensures a wallet holds at least `minimumLamports`. When `sponsor` is given,
 * funds come from the sponsor (used after the deploy payer is funded once, so
 * the devnet faucet is only hit for a single wallet); otherwise the faucet is
 * used with retries because devnet airdrops are rate limited.
 */
export async function ensureSolBalance(connection, owner, minimumLamports, sponsor) {
    const buffer = 50000000n;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const balance = BigInt(await connection.getBalance(owner, "confirmed"));
        if (balance >= minimumLamports)
            return;
        const need = minimumLamports + buffer - balance;
        const request = need > 2000000000n ? 2000000000n : need;
        try {
            if (sponsor) {
                const transfer = new Transaction().add(SystemProgram.transfer({
                    fromPubkey: sponsor.publicKey,
                    toPubkey: owner,
                    lamports: Number(request),
                }));
                await confirmTransactionWithPayer(connection, transfer, [sponsor]);
            }
            else {
                await connection.requestAirdrop(owner, Number(request));
            }
        }
        catch {
            // Faucets are rate limited and devnet drops the occasional request; retry.
        }
        await new Promise((sleep) => setTimeout(sleep, 5_000));
    }
    throw new Error(`Could not fund ${owner.toBase58()} to ${minimumLamports.toString()} lamports. ` +
        "Devnet airdrops are rate limited; retry shortly or fund the wallet manually.");
}
export function parseDevnetArgs(argv) {
    const flags = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith("--"))
            continue;
        const equals = arg.indexOf("=");
        if (equals > 0) {
            flags.set(arg.slice(2, equals), arg.slice(equals + 1));
        }
        else {
            flags.set(arg.slice(2), argv[index + 1] ?? "");
            index += 1;
        }
    }
    const programRaw = flags.get("program") ??
        process.env.MARKDESK_PROGRAM_ID ??
        process.env.NEXT_PUBLIC_MARKDESK_PROGRAM_ID;
    if (!programRaw) {
        throw new Error("Pass --program <pubkey> (or set MARKDESK_PROGRAM_ID) with the deployed program id.");
    }
    const programId = new PublicKey(programRaw);
    const markUsd = flags.get("mark-usd") ? Number(flags.get("mark-usd")) : null;
    if (markUsd !== null && (!Number.isFinite(markUsd) || markUsd <= 0)) {
        throw new RangeError("--mark-usd must be a positive number.");
    }
    return {
        programId,
        rpcUrl: flags.get("rpc") ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_DEVNET_RPC,
        markUsd,
        baseMint: flags.get("base-mint") ? new PublicKey(flags.get("base-mint")) : null,
        quoteMint: flags.get("quote-mint") ? new PublicKey(flags.get("quote-mint")) : null,
        fundAddress: flags.get("fund-address") ? new PublicKey(flags.get("fund-address")) : null,
        buyerNet: flags.get("buyer-net") ?? "0.25",
    };
}
/**
 * The synthetic devnet mint stands in for ANDURIL, so its mark is the official
 * ANDURIL mark from the PreStocks API, falling back to the labeled repository
 * snapshot exactly like the web catalog.
 */
export async function fetchAndurilMark(markUsdOverride) {
    if (markUsdOverride !== null) {
        return {
            symbol: "ANDURIL",
            markPrice: markUsdOverride,
            markPriceE6: BigInt(Math.round(markUsdOverride * 1_000_000)),
            source: "snapshot",
        };
    }
    let assets;
    let source = "live";
    try {
        const response = await fetch("https://prestocks.com/api/prestocks", {
            headers: { accept: "application/json", "user-agent": "markdesk-devnet/0.1" },
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok)
            throw new Error(`upstream returned HTTP ${response.status}`);
        assets = normalizePreStocks(await response.json());
    }
    catch {
        const fixture = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, "fixtures/prestocks.snapshot.json"), "utf8"));
        assets = normalizePreStocks(fixture.assets);
        source = "snapshot";
    }
    const anduril = assets.find((asset) => asset.mint === PRESTOCKS_MINTS.ANDURIL);
    if (!anduril)
        throw new Error("ANDURIL missing from the PreStocks catalog.");
    return {
        symbol: "ANDURIL",
        markPrice: anduril.markPrice,
        markPriceE6: BigInt(anduril.markPriceE6),
        source,
    };
}
export async function readDevnetState() {
    try {
        return JSON.parse(await readFile(stateFilePath(), "utf8"));
    }
    catch {
        return null;
    }
}
export async function writeDevnetState(state) {
    const path = stateFilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
export function explorerTx(signature) {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
export function explorerAddress(address) {
    return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
