import { MARKDESK_SEEDS } from "@markdesk/core";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
export { ASSOCIATED_TOKEN_PROGRAM_ID };
/** Config PDA: ["config"] */
export function configAddress(programId) {
    return PublicKey.findProgramAddressSync([Buffer.from(MARKDESK_SEEDS.config)], programId)[0];
}
/** Mark PDA: ["mark", base_mint] */
export function markAddress(baseMint, programId) {
    return PublicKey.findProgramAddressSync([Buffer.from(MARKDESK_SEEDS.mark), baseMint.toBuffer()], programId)[0];
}
/** Offer PDA: ["offer", maker, offer_id_le] */
export function offerAddress(maker, offerId, programId) {
    const offerIdLe = Buffer.alloc(8);
    offerIdLe.writeBigUInt64LE(offerId);
    return PublicKey.findProgramAddressSync([Buffer.from(MARKDESK_SEEDS.offer), maker.toBuffer(), offerIdLe], programId)[0];
}
/** The offer's escrow vault: base-mint ATA owned by the Offer PDA. */
export function offerVaultAddress(offer, baseMint, baseTokenProgram) {
    return getAssociatedTokenAddressSync(baseMint, offer, true, baseTokenProgram);
}
/** A wallet's ATA for a mint under either token program. */
export function walletTokenAddress(owner, mint, tokenProgram) {
    return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
}
export function isTokenProgram(program) {
    return program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);
}
