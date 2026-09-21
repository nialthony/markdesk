/**
 * Shared helpers for the MarkDesk devnet bootstrap and two-wallet flow check.
 *
 * Everything here is Node-only (the web app never imports this module). Keys
 * are created on demand under `var/keys` (gitignored) with mode 0600 and are
 * never committed; treat them as throwaway devnet fixtures.
 */

import { normalizePreStocks, PRESTOCKS_MINTS, type PreStockAsset } from "@markdesk/core";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Devnet keys never enter git; override the directory with MARKDESK_KEYS_DIR. */
export function keysDirectory(): string {
  return process.env.MARKDESK_KEYS_DIR ?? resolve(REPOSITORY_ROOT, "var/keys");
}

export function stateFilePath(): string {
  return process.env.MARKDESK_STATE_FILE ?? resolve(REPOSITORY_ROOT, "var/state/devnet.json");
}

export interface LoadedKeypair {
  keypair: Keypair;
  path: string;
  created: boolean;
}

export async function loadOrCreateKeypair(name: string): Promise<LoadedKeypair> {
  const path = resolve(keysDirectory(), `${name}.json`);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as number[];
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), path, created: false };
  } catch {
    const keypair = Keypair.generate();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, { mode: 0o600 });
    return { keypair, path, created: true };
  }
}

/** A TransactionSigner backed by a local keypair instead of a wallet. */
export function keypairSigner(keypair: Keypair): {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
} {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (transaction: Transaction) => {
      transaction.partialSign(keypair);
      return transaction;
    },
  };
}

export async function ensureSolBalance(
  connection: Connection,
  owner: PublicKey,
  minimumLamports: bigint,
): Promise<void> {
  const balance = await connection.getBalance(owner, "confirmed");
  if (BigInt(balance) >= minimumLamports) return;

  const target = 1_000_000_000; // 1 SOL
  await connection.requestAirdrop(
    owner,
    Math.max(target - balance, Number(minimumLamports - BigInt(balance))),
  );
  // Airdrops confirm asynchronously; poll the balance instead of blocking on
  // a single confirmTransaction window.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((sleep) => setTimeout(sleep, 2_000));
    const next = await connection.getBalance(owner, "confirmed");
    if (BigInt(next) >= minimumLamports) return;
  }
  throw new Error(
    `Airdrop to ${owner.toBase58()} did not land in time. Devnet faucets are rate limited; retry shortly.`,
  );
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export interface DevnetArgs {
  programId: PublicKey;
  rpcUrl: string;
  markUsd: number | null;
  baseMint: PublicKey | null;
  quoteMint: PublicKey | null;
  fundAddress: PublicKey | null;
  buyerNet: string;
}

export function parseDevnetArgs(argv: string[]): DevnetArgs {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    if (equals > 0) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
    } else {
      flags.set(arg.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }

  const programRaw =
    flags.get("program") ??
    process.env.MARKDESK_PROGRAM_ID ??
    process.env.NEXT_PUBLIC_MARKDESK_PROGRAM_ID;
  if (!programRaw) {
    throw new Error(
      "Pass --program <pubkey> (or set MARKDESK_PROGRAM_ID) with the deployed program id.",
    );
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
    baseMint: flags.get("base-mint") ? new PublicKey(flags.get("base-mint")!) : null,
    quoteMint: flags.get("quote-mint") ? new PublicKey(flags.get("quote-mint")!) : null,
    fundAddress: flags.get("fund-address") ? new PublicKey(flags.get("fund-address")!) : null,
    buyerNet: flags.get("buyer-net") ?? "0.25",
  };
}

// ---------------------------------------------------------------------------
// Mark source
// ---------------------------------------------------------------------------

export interface AnchorMark {
  symbol: string;
  markPrice: number;
  markPriceE6: bigint;
  source: "live" | "snapshot";
}

/**
 * The synthetic devnet mint stands in for ANDURIL, so its mark is the official
 * ANDURIL mark from the PreStocks API, falling back to the labeled repository
 * snapshot exactly like the web catalog.
 */
export async function fetchAndurilMark(markUsdOverride: number | null): Promise<AnchorMark> {
  if (markUsdOverride !== null) {
    return {
      symbol: "ANDURIL",
      markPrice: markUsdOverride,
      markPriceE6: BigInt(Math.round(markUsdOverride * 1_000_000)),
      source: "snapshot",
    };
  }

  let assets: PreStockAsset[];
  let source: "live" | "snapshot" = "live";
  try {
    const response = await fetch("https://prestocks.com/api/prestocks", {
      headers: { accept: "application/json", "user-agent": "markdesk-devnet/0.1" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);
    assets = normalizePreStocks(await response.json());
  } catch {
    const fixture = JSON.parse(
      await readFile(resolve(REPOSITORY_ROOT, "fixtures/prestocks.snapshot.json"), "utf8"),
    ) as { assets: unknown };
    assets = normalizePreStocks(fixture.assets);
    source = "snapshot";
  }

  const anduril = assets.find((asset) => asset.mint === PRESTOCKS_MINTS.ANDURIL);
  if (!anduril) throw new Error("ANDURIL missing from the PreStocks catalog.");
  return {
    symbol: "ANDURIL",
    markPrice: anduril.markPrice,
    markPriceE6: BigInt(anduril.markPriceE6),
    source,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap state file
// ---------------------------------------------------------------------------

export interface DevnetState {
  cluster: string;
  programId: string;
  baseMint: string;
  baseSymbol: string;
  baseDecimals: number;
  quoteMint: string;
  quoteDecimals: number;
  configAddress: string;
  publisher: string;
  payer: string;
  generatedAt: string;
}

export async function readDevnetState(): Promise<DevnetState | null> {
  try {
    return JSON.parse(await readFile(stateFilePath(), "utf8")) as DevnetState;
  } catch {
    return null;
  }
}

export async function writeDevnetState(state: DevnetState): Promise<void> {
  const path = stateFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
