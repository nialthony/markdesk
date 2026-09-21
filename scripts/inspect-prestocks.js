import { AccountState, ExtensionType, TOKEN_2022_PROGRAM_ID, getDefaultAccountState, getExtensionTypes, getMetadataPointerState, getMint, getMintCloseAuthority, getPausableConfig, getPermanentDelegate, getScaledUiAmountConfig, getTransferFeeConfig, getTransferHook, } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { normalizePreStocks } from "@markdesk/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const PRESTOCKS_API = "https://prestocks.com/api/prestocks";
const UNKNOWN_EXTENSION_NAMES = {
    16: "ConfidentialTransferFeeConfig",
    17: "ConfidentialTransferFeeAmount",
    24: "ConfidentialMintBurn",
};
function publicKey(value) {
    return value?.toBase58() ?? null;
}
function extensionName(value) {
    return ExtensionType[value] ?? UNKNOWN_EXTENSION_NAMES[value] ?? `Unknown(${value})`;
}
function bigintString(value) {
    return value.toString();
}
function parseOutputPath() {
    const outputFlag = process.argv.indexOf("--output");
    const value = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
    return resolve(value ?? "research/prestocks-mint-scan.latest.json");
}
async function inspectMint(connection, epoch, clusterTimestamp, asset) {
    const address = new PublicKey(asset.mint);
    const account = await connection.getAccountInfo(address, "confirmed");
    if (!account)
        throw new Error(`Mint account not found: ${asset.mint}`);
    const mint = await getMint(connection, address, "confirmed", TOKEN_2022_PROGRAM_ID);
    const transferFee = getTransferFeeConfig(mint);
    const currentTransferFee = transferFee
        ? epoch >= transferFee.newerTransferFee.epoch
            ? transferFee.newerTransferFee
            : transferFee.olderTransferFee
        : null;
    const nextTransferFee = transferFee && epoch < transferFee.newerTransferFee.epoch ? transferFee.newerTransferFee : null;
    const transferHook = getTransferHook(mint);
    const permanentDelegate = getPermanentDelegate(mint);
    const defaultState = getDefaultAccountState(mint);
    const scaled = getScaledUiAmountConfig(mint);
    const activeMultiplier = scaled
        ? clusterTimestamp >= Number(scaled.newMultiplierEffectiveTimestamp)
            ? scaled.newMultiplier
            : scaled.multiplier
        : 1;
    const pausable = getPausableConfig(mint);
    const mintClose = getMintCloseAuthority(mint);
    const metadataPointer = getMetadataPointerState(mint);
    const hookProgram = publicKey(transferHook?.programId);
    const hookActive = hookProgram !== null && hookProgram !== SystemProgram.programId.toBase58();
    const rawSupplyTokens = Number(mint.supply) / 10 ** mint.decimals;
    const scaledSupply = rawSupplyTokens * activeMultiplier;
    return {
        symbol: asset.symbol,
        name: asset.name,
        mint: asset.mint,
        accountOwner: account.owner.toBase58(),
        accountDataLength: account.data.length,
        decimals: mint.decimals,
        rawSupply: mint.supply.toString(),
        rawSupplyTokens,
        scaledUiSupply: scaledSupply,
        apiSupply: asset.supply,
        authorities: {
            mint: publicKey(mint.mintAuthority),
            freeze: publicKey(mint.freezeAuthority),
            permanentDelegate: publicKey(permanentDelegate?.delegate),
            pause: publicKey(pausable?.authority),
        },
        extensions: getExtensionTypes(mint.tlvData).map(extensionName),
        transferFee: transferFee
            ? {
                configAuthority: publicKey(transferFee.transferFeeConfigAuthority),
                withdrawWithheldAuthority: publicKey(transferFee.withdrawWithheldAuthority),
                withheldOnMintRaw: transferFee.withheldAmount.toString(),
                current: currentTransferFee
                    ? {
                        epoch: bigintString(currentTransferFee.epoch),
                        basisPoints: currentTransferFee.transferFeeBasisPoints,
                        maximumFeeRaw: currentTransferFee.maximumFee.toString(),
                    }
                    : null,
                scheduled: nextTransferFee
                    ? {
                        epoch: bigintString(nextTransferFee.epoch),
                        basisPoints: nextTransferFee.transferFeeBasisPoints,
                        maximumFeeRaw: nextTransferFee.maximumFee.toString(),
                    }
                    : null,
            }
            : null,
        transferHook: transferHook
            ? {
                authority: publicKey(transferHook.authority),
                programId: hookProgram,
                active: hookActive,
            }
            : null,
        scaledUiAmount: scaled
            ? {
                authority: publicKey(scaled.authority),
                multiplier: scaled.multiplier,
                newMultiplier: scaled.newMultiplier,
                newMultiplierEffectiveTimestamp: bigintString(scaled.newMultiplierEffectiveTimestamp),
                activeMultiplier,
            }
            : null,
        pausable: pausable
            ? {
                authority: publicKey(pausable.authority),
                paused: pausable.paused,
            }
            : null,
        defaultAccountState: defaultState
            ? {
                value: defaultState.state,
                label: AccountState[defaultState.state] ?? `Unknown(${defaultState.state})`,
            }
            : null,
        mintCloseAuthority: publicKey(mintClose?.closeAuthority),
        metadataAddress: publicKey(metadataPointer?.metadataAddress),
        protocolRequirements: {
            // Presence matters even when today's value is zero/one: each authority can schedule a change.
            transferFeeGrossUp: transferFee !== null,
            harvestVaultWithheldFees: transferFee !== null,
            scaledUiQuoteMath: scaled !== null,
            transferHookExtraAccounts: hookActive,
            issuerCanMoveVaultFunds: publicKey(permanentDelegate?.delegate) !== null,
            issuerCanPauseTransfers: publicKey(pausable?.authority) !== null,
        },
    };
}
async function main() {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC;
    const connection = new Connection(rpcUrl, "confirmed");
    const response = await fetch(PRESTOCKS_API, {
        headers: { accept: "application/json", "user-agent": "markdesk-mint-inspector/0.1" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
        throw new Error(`PreStocks API returned HTTP ${response.status}`);
    const assets = normalizePreStocks(await response.json());
    const epochInfo = await connection.getEpochInfo("confirmed");
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    const clusterTimestamp = blockTime ?? Math.floor(Date.now() / 1_000);
    const rows = [];
    for (const asset of assets) {
        rows.push(await inspectMint(connection, BigInt(epochInfo.epoch), clusterTimestamp, asset));
    }
    const output = {
        schema: "markdesk.prestocks-mint-scan.v1",
        generatedAt: new Date().toISOString(),
        source: PRESTOCKS_API,
        rpc: rpcUrl === DEFAULT_RPC ? DEFAULT_RPC : "custom RPC",
        cluster: {
            epoch: epochInfo.epoch,
            slot,
            unixTimestamp: clusterTimestamp,
        },
        warning: "Point-in-time on-chain inspection. Authorities and extension settings can change.",
        assets: rows,
    };
    const path = parseOutputPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Inspected ${rows.length} PreStocks mints at epoch ${epochInfo.epoch}.`);
    console.log(`Wrote ${path}`);
    console.table(rows.map((row) => ({
        symbol: row.symbol,
        decimals: row.decimals,
        feeBps: row.transferFee?.current?.basisPoints ?? 0,
        scheduledFeeBps: row.transferFee?.scheduled?.basisPoints ?? "—",
        multiplier: row.scaledUiAmount?.activeMultiplier ?? 1,
        hook: row.transferHook?.active ? "active" : "none",
        paused: row.pausable?.paused ?? false,
    })));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
