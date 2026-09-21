/**
 * Pure transaction builders for devnet bootstrap operations. Account ordering
 * mirrors the program's `#[derive(Accounts)]` structs; instruction payloads
 * come from the shared `@markdesk/core` codec.
 */
import { encodeInitializeConfig, encodePublishMark, MARKDESK_SEEDS } from "@markdesk/core";
import { AccountState, createAssociatedTokenAccountIdempotentInstruction, createInitializeDefaultAccountStateInstruction, createInitializeMint2Instruction, createInitializePausableConfigInstruction, createInitializePermanentDelegateInstruction, createInitializeScaledUiAmountConfigInstruction, createInitializeTransferFeeConfigInstruction, createMintToInstruction, ExtensionType, getMintLen, TOKEN_2022_PROGRAM_ID, } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
export const SYNTHETIC_BASE_DECIMALS = 9;
export const SYNTHETIC_QUOTE_DECIMALS = 6;
/** Mirrors the SBF fixture: 50 bps, uncapped for tested amounts. */
export const SYNTHETIC_TRANSFER_FEE_BPS = 50;
export const SYNTHETIC_MAX_FEE = 0xffffffffffffffffn;
/** Rent-exempt account sizes for the synthetic mints. */
export const SYNTHETIC_BASE_MINT_SPACE = getMintLen([
    ExtensionType.TransferFeeConfig,
    ExtensionType.PermanentDelegate,
    ExtensionType.PausableConfig,
    ExtensionType.DefaultAccountState,
    ExtensionType.ScaledUiAmountConfig,
]);
export const SYNTHETIC_QUOTE_MINT_SPACE = getMintLen([]);
function configAddress(programId) {
    return PublicKey.findProgramAddressSync([Buffer.from(MARKDESK_SEEDS.config)], programId)[0];
}
function markAddress(baseMint, programId) {
    return PublicKey.findProgramAddressSync([Buffer.from(MARKDESK_SEEDS.mark), baseMint.toBuffer()], programId)[0];
}
/** Accounts: authority (signer), config (PDA init), quote_mint, system. */
export function buildInitializeConfigTransaction(input) {
    const transaction = new Transaction();
    transaction.feePayer = input.authority;
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), {
        keys: [
            { pubkey: input.authority, isSigner: true, isWritable: true },
            { pubkey: configAddress(input.programId), isSigner: false, isWritable: true },
            { pubkey: input.quoteMint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: input.programId,
        data: Buffer.from(encodeInitializeConfig({
            publisher: input.publisher.toBytes(),
            maxMarkAgeSeconds: input.maxMarkAgeSeconds,
        })),
    });
    return transaction;
}
/** Accounts: publisher (signer), config, base_mint, mark (PDA init_if_needed), system. */
export function buildPublishMarkTransaction(input) {
    const transaction = new Transaction();
    transaction.feePayer = input.publisher;
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), {
        keys: [
            { pubkey: input.publisher, isSigner: true, isWritable: true },
            { pubkey: configAddress(input.programId), isSigner: false, isWritable: false },
            { pubkey: input.baseMint, isSigner: false, isWritable: false },
            { pubkey: markAddress(input.baseMint, input.programId), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: input.programId,
        data: Buffer.from(encodePublishMark({
            priceE6: input.priceE6,
            observedAtSeconds: input.observedAtSeconds,
            sequence: input.sequence,
        })),
    });
    return transaction;
}
/**
 * Synthetic PreStocks-like base mint: Token-2022 with the SBF fixture's
 * extension profile (transfer fee, permanent delegate, pausable, default
 * account state, scaled UI at 1×). TransferHook stays absent because its
 * initializer requires a hook program; the program treats both identically.
 */
export function buildSyntheticBaseMintTransaction(input) {
    const space = getMintLen([
        ExtensionType.TransferFeeConfig,
        ExtensionType.PermanentDelegate,
        ExtensionType.PausableConfig,
        ExtensionType.DefaultAccountState,
        ExtensionType.ScaledUiAmountConfig,
    ]);
    const transaction = new Transaction();
    transaction.feePayer = input.payer;
    transaction.add(SystemProgram.createAccount({
        fromPubkey: input.payer,
        newAccountPubkey: input.mint,
        lamports: input.lamports,
        space,
        programId: TOKEN_2022_PROGRAM_ID,
    }), createInitializeTransferFeeConfigInstruction(input.mint, input.authority, input.authority, SYNTHETIC_TRANSFER_FEE_BPS, SYNTHETIC_MAX_FEE, TOKEN_2022_PROGRAM_ID), createInitializePermanentDelegateInstruction(input.mint, input.authority, TOKEN_2022_PROGRAM_ID), createInitializePausableConfigInstruction(input.mint, input.authority, TOKEN_2022_PROGRAM_ID), createInitializeDefaultAccountStateInstruction(input.mint, AccountState.Initialized, TOKEN_2022_PROGRAM_ID), createInitializeScaledUiAmountConfigInstruction(input.mint, input.authority, 1, TOKEN_2022_PROGRAM_ID), createInitializeMint2Instruction(input.mint, SYNTHETIC_BASE_DECIMALS, input.authority, input.authority, TOKEN_2022_PROGRAM_ID));
    return { transaction, space };
}
/** Plain 6-decimal Token-2022 quote mint with no transfer deductions. */
export function buildQuoteMintTransaction(input) {
    const transaction = new Transaction();
    transaction.feePayer = input.payer;
    transaction.add(SystemProgram.createAccount({
        fromPubkey: input.payer,
        newAccountPubkey: input.mint,
        lamports: input.lamports,
        space: getMintLen([]),
        programId: TOKEN_2022_PROGRAM_ID,
    }), createInitializeMint2Instruction(input.mint, SYNTHETIC_QUOTE_DECIMALS, input.authority, null, TOKEN_2022_PROGRAM_ID));
    return transaction;
}
/** Idempotent ATA creation plus a mint top-up for a wallet. */
export function buildFundWalletTransaction(input) {
    const ownerAta = PublicKey.findProgramAddressSync([input.owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), input.mint.toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
    const transaction = new Transaction();
    transaction.feePayer = input.payer;
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(input.payer, ownerAta, input.owner, input.mint, TOKEN_2022_PROGRAM_ID), createMintToInstruction(input.mint, ownerAta, input.mintAuthority, input.amountRaw, [], TOKEN_2022_PROGRAM_ID));
    return transaction;
}
export { configAddress as devnetConfigAddress, markAddress as devnetMarkAddress };
