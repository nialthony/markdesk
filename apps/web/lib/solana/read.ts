import {
  decodeAnchorEvent,
  decodeConfigAccount,
  decodeMarkAccount,
  decodeOfferAccount,
  isMarkFresh,
  type TransferFeeTerms,
} from "@markdesk/core";
import {
  AccountState,
  getDefaultAccountState,
  getExtensionTypes,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferFeeAmount,
  getTransferFeeConfig,
  getTransferHook,
  unpackAccount,
  unpackMint,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type AccountInfo,
  type Connection,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { type ClusterConfig } from "./cluster";
import { configAddress, markAddress, offerVaultAddress, walletTokenAddress } from "./pdas";

export type ProtocolEvent = NonNullable<ReturnType<typeof decodeAnchorEvent>>;

export interface ActiveFeeTerms extends TransferFeeTerms {
  epoch: bigint;
}

export interface MintInsights {
  address: string;
  tokenProgram: string;
  isToken2022: boolean;
  decimals: number;
  supplyRaw: bigint;
  extensionNames: string[];
  /** Active epoch fee plus the scheduled change, when one exists. */
  fee: {
    current: ActiveFeeTerms | null;
    scheduled: ActiveFeeTerms | null;
    configAuthority: string | null;
    withdrawWithheldAuthority: string | null;
    withheldOnMintRaw: bigint | null;
  };
  scaledUi: {
    /** Active multiplier mirroring the program's f32→f64 selection. */
    activeMultiplier: number;
    pendingMultiplier: number | null;
    pendingEffectiveAt: number | null;
  } | null;
  pausable: { paused: boolean; authority: string | null } | null;
  /**
   * `active` mirrors the program: any non-default hook program id makes the
   * program reject the transfer (`ActiveTransferHookUnsupported`).
   */
  transferHook: { programId: string | null; active: boolean; authority: string | null } | null;
  permanentDelegate: string | null;
  defaultAccountState: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface TokenPosition {
  address: PublicKey;
  tokenProgram: PublicKey;
  /** null when the associated token account does not exist yet. */
  amountRaw: bigint | null;
  /** Withheld transfer fee parked in the account's Token-2022 extension. */
  withheldRaw: bigint | null;
}

export interface DecodedConfigView {
  address: string;
  publisher: string;
  quoteMint: string;
  maxMarkAgeSeconds: number;
}

export interface DecodedMarkView {
  address: string;
  mint: string;
  priceE6: bigint;
  observedAtSeconds: bigint;
  sequence: bigint;
  ageSeconds: number;
  fresh: boolean;
}

export interface ProtocolRead {
  readAtMs: number;
  cluster: ClusterConfig;
  programDeployed: boolean;
  config: DecodedConfigView | null;
  mark: DecodedMarkView | null;
  baseMint: MintInsights | null;
  quoteMint: { address: string; tokenProgram: string; decimals: number } | null;
  wallet: { base: TokenPosition | null; quote: TokenPosition | null } | null;
  epoch: bigint;
  nowSeconds: number;
}

export interface OfferRead {
  readAtMs: number;
  cluster: ClusterConfig;
  programDeployed: boolean;
  offer: {
    address: string;
    maker: string;
    baseMint: string;
    quoteMint: string;
    offerId: bigint;
    baseAmount: bigint;
    offsetBps: number;
    createdAtSeconds: bigint;
    expiresAtSeconds: bigint;
  };
  vault: { address: string; amountRaw: bigint | null; closed: boolean };
  baseMint: MintInsights | null;
  config: DecodedConfigView | null;
  mark: DecodedMarkView | null;
  quoteMint: ProtocolRead["quoteMint"];
  wallet: ProtocolRead["wallet"];
  /** The maker's quote position, needed to verify the fill payment. */
  makerQuote: TokenPosition | null;
  epoch: bigint;
  nowSeconds: number;
}

export function hexToBase58(hex: string): string {
  return new PublicKey(Buffer.from(hex, "hex")).toBase58();
}

function decodeMintInsights(
  mintAddress: PublicKey,
  info: AccountInfo<Buffer> | null,
  clusterTimestampSeconds: number,
  epoch: bigint,
): MintInsights | null {
  if (!info) return null;
  const isToken2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (
    !isToken2022 &&
    !info.owner.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
  ) {
    return null;
  }

  const mint = unpackMint(mintAddress, info, info.owner);
  const transferFee = getTransferFeeConfig(mint);
  const scaled = getScaledUiAmountConfig(mint);
  const pausable = getPausableConfig(mint);
  const hook = getTransferHook(mint);

  const currentTerms =
    transferFee && epoch >= transferFee.newerTransferFee.epoch
      ? transferFee.newerTransferFee
      : (transferFee?.olderTransferFee ?? null);
  const scheduledTerms =
    transferFee && epoch < transferFee.newerTransferFee.epoch ? transferFee.newerTransferFee : null;

  const pendingActive =
    scaled !== null && clusterTimestampSeconds >= Number(scaled.newMultiplierEffectiveTimestamp);
  const hookProgramId = hook?.programId?.toBase58() ?? null;
  const defaultState = getDefaultAccountState(mint)?.state;

  return {
    address: mintAddress.toBase58(),
    tokenProgram: info.owner.toBase58(),
    isToken2022,
    decimals: mint.decimals,
    supplyRaw: mint.supply,
    extensionNames: getExtensionTypes(mint.tlvData).map((type) => String(type)),
    fee: {
      current: currentTerms
        ? {
            epoch,
            basisPoints: currentTerms.transferFeeBasisPoints,
            maximumFeeRaw: currentTerms.maximumFee,
          }
        : null,
      scheduled: scheduledTerms
        ? {
            epoch: scheduledTerms.epoch,
            basisPoints: scheduledTerms.transferFeeBasisPoints,
            maximumFeeRaw: scheduledTerms.maximumFee,
          }
        : null,
      configAuthority: transferFee?.transferFeeConfigAuthority?.toBase58() ?? null,
      withdrawWithheldAuthority: transferFee?.withdrawWithheldAuthority?.toBase58() ?? null,
      withheldOnMintRaw: transferFee?.withheldAmount ?? null,
    },
    scaledUi: scaled
      ? {
          activeMultiplier: pendingActive ? scaled.newMultiplier : scaled.multiplier,
          pendingMultiplier: pendingActive ? null : scaled.newMultiplier,
          pendingEffectiveAt: pendingActive ? null : Number(scaled.newMultiplierEffectiveTimestamp),
        }
      : null,
    pausable: pausable
      ? { paused: Boolean(pausable.paused), authority: pausable.authority.toBase58() }
      : null,
    transferHook: hook
      ? {
          programId: hookProgramId,
          active: hookProgramId !== null,
          authority: hook.authority.toBase58(),
        }
      : null,
    permanentDelegate: getPermanentDelegate(mint)?.delegate.toBase58() ?? null,
    defaultAccountState:
      defaultState === AccountState.Frozen
        ? "Frozen"
        : defaultState === AccountState.Initialized
          ? "Initialized"
          : "Uninitialized",
    mintAuthority: mint.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
  };
}

async function readTokenPosition(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<TokenPosition> {
  const address = walletTokenAddress(owner, mint, tokenProgram);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) {
    return { address, tokenProgram, amountRaw: null, withheldRaw: null };
  }
  const account = unpackAccount(address, info, tokenProgram);
  return {
    address,
    tokenProgram,
    amountRaw: account.amount,
    withheldRaw: getTransferFeeAmount(account)?.withheldAmount ?? 0n,
  };
}

export async function readProtocolState(input: {
  connection: Connection;
  cluster: ClusterConfig;
  baseMint: PublicKey;
  wallet: PublicKey | null;
}): Promise<ProtocolRead> {
  const { connection, cluster, baseMint, wallet } = input;

  const [programInfo, configInfo, epochInfo] = await Promise.all([
    connection.getAccountInfo(cluster.programId, "confirmed"),
    connection.getAccountInfo(configAddress(cluster.programId), "confirmed"),
    connection.getEpochInfo("confirmed"),
  ]);
  const epoch = BigInt(epochInfo.epoch);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const config = configInfo ? decodeConfigAccount(Buffer.from(configInfo.data)) : null;
  const quoteMintKey = config ? new PublicKey(hexToBase58(config.quoteMint)) : null;

  const [markInfo, baseMintInfo, quoteMintInfo] = await connection.getMultipleAccountsInfo(
    [markAddress(baseMint, cluster.programId), baseMint, ...(quoteMintKey ? [quoteMintKey] : [])],
    "confirmed",
  );

  const mark = markInfo ? decodeMarkAccount(Buffer.from(markInfo.data)) : null;
  const baseInsights = decodeMintInsights(baseMint, baseMintInfo, nowSeconds, epoch);
  const quoteMint = quoteMintInfo
    ? {
        address: quoteMintKey!.toBase58(),
        tokenProgram: quoteMintInfo.owner.toBase58(),
        decimals: unpackMint(quoteMintKey!, quoteMintInfo, quoteMintInfo.owner).decimals,
      }
    : null;

  let positions: ProtocolRead["wallet"] = null;
  if (wallet) {
    const base = baseInsights
      ? await readTokenPosition(
          connection,
          wallet,
          baseMint,
          new PublicKey(baseInsights.tokenProgram),
        )
      : null;
    const quote = quoteMint
      ? await readTokenPosition(
          connection,
          wallet,
          new PublicKey(quoteMint.address),
          new PublicKey(quoteMint.tokenProgram),
        )
      : null;
    positions = { base, quote };
  }

  return {
    readAtMs: Date.now(),
    cluster,
    programDeployed: programInfo !== null && programInfo.executable,
    config: config
      ? {
          address: configAddress(cluster.programId).toBase58(),
          publisher: hexToBase58(config.publisher),
          quoteMint: hexToBase58(config.quoteMint),
          maxMarkAgeSeconds: config.maxMarkAgeSeconds,
        }
      : null,
    mark: mark
      ? {
          address: markAddress(baseMint, cluster.programId).toBase58(),
          mint: hexToBase58(mark.mint),
          priceE6: mark.priceE6,
          observedAtSeconds: mark.observedAt,
          sequence: mark.sequence,
          ageSeconds: nowSeconds - Number(mark.observedAt),
          fresh: config
            ? isMarkFresh(Number(mark.observedAt), nowSeconds, config.maxMarkAgeSeconds)
            : false,
        }
      : null,
    baseMint: baseInsights,
    quoteMint,
    wallet: positions,
    epoch,
    nowSeconds,
  };
}

export async function readOfferState(input: {
  connection: Connection;
  cluster: ClusterConfig;
  offer: PublicKey;
  wallet: PublicKey | null;
}): Promise<OfferRead | null> {
  const { connection, cluster, offer: offerKey, wallet } = input;
  const offerInfo = await connection.getAccountInfo(offerKey, "confirmed");
  if (!offerInfo) return null;

  const decoded = decodeOfferAccount(Buffer.from(offerInfo.data));
  const maker = new PublicKey(hexToBase58(decoded.maker));
  const baseMintKey = new PublicKey(hexToBase58(decoded.baseMint));

  const baseRead = await readProtocolState({
    connection,
    cluster,
    baseMint: baseMintKey,
    wallet,
  });

  const baseTokenProgram = new PublicKey(baseRead.baseMint?.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const vaultKey = offerVaultAddress(offerKey, baseMintKey, baseTokenProgram);
  const vaultInfo = await connection.getAccountInfo(vaultKey, "confirmed");

  const makerQuote = baseRead.quoteMint
    ? await readTokenPosition(
        connection,
        maker,
        new PublicKey(baseRead.quoteMint.address),
        new PublicKey(baseRead.quoteMint.tokenProgram),
      )
    : null;

  return {
    readAtMs: Date.now(),
    cluster,
    programDeployed: baseRead.programDeployed,
    offer: {
      address: offerKey.toBase58(),
      maker: maker.toBase58(),
      baseMint: baseMintKey.toBase58(),
      quoteMint: hexToBase58(decoded.quoteMint),
      offerId: decoded.offerId,
      baseAmount: decoded.baseAmount,
      offsetBps: decoded.offsetBps,
      createdAtSeconds: decoded.createdAt,
      expiresAtSeconds: decoded.expiresAt,
    },
    vault: {
      address: vaultKey.toBase58(),
      amountRaw: vaultInfo ? unpackAccount(vaultKey, vaultInfo, baseTokenProgram).amount : null,
      closed: vaultInfo === null,
    },
    baseMint: baseRead.baseMint,
    config: baseRead.config,
    mark: baseRead.mark,
    quoteMint: baseRead.quoteMint,
    wallet: baseRead.wallet,
    makerQuote,
    epoch: baseRead.epoch,
    nowSeconds: baseRead.nowSeconds,
  };
}

/** Extracts Anchor events from a confirmed transaction's program logs. */
export function eventsFromTransaction(
  response: VersionedTransactionResponse | null,
): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  for (const log of response?.meta?.logMessages ?? []) {
    if (!log.startsWith("Program data: ")) continue;
    const decoded = decodeAnchorEvent(log.slice("Program data: ".length));
    if (decoded !== null) events.push(decoded);
  }
  return events;
}
