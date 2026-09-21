/**
 * Prints the program id of a keypair file (e.g. target/deploy/markdesk-keypair.json)
 * and the exact `declare_id!` line to paste into programs/markdesk/src/lib.rs.
 *
 * This is the plain-Agave equivalent of `anchor keys sync` when the Anchor CLI
 * is not installed.
 *
 * Usage: npx tsx scripts/devnet/program-id.ts <path-to-keypair.json>
 */
import { Keypair } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
async function main() {
    const path = process.argv[2];
    if (!path) {
        console.error("Usage: npx tsx scripts/devnet/program-id.ts <path-to-keypair.json>");
        process.exit(1);
    }
    const raw = JSON.parse(await readFile(path, "utf8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    const id = keypair.publicKey.toBase58();
    console.log(`Program id: ${id}`);
    console.log(`\nprograms/markdesk/src/lib.rs:`);
    console.log(`declare_id!("${id}");`);
    console.log(`\nAnchor.toml [programs.localnet] / [programs.devnet]:`);
    console.log(`markdesk = "${id}"`);
    console.log(`\napps/web/.env.local:`);
    console.log(`NEXT_PUBLIC_MARKDESK_PROGRAM_ID=${id}`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
