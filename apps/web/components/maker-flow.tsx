"use client";

import {
  MARKDESK_FLAGSHIP_MINT,
  PRESTOCKS_MINTS,
  applyOffsetToPrice,
  parseDecimalToRaw,
  type PreStockAsset,
} from "@markdesk/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock } from "./icons";
import {
  Blockers,
  BoundsCard,
  CopyButton,
  FlowReceipt,
  StageRail,
  formatRaw,
  formatUsdFromE6,
} from "./flow-shared";
import { ChainReadPanel } from "./chain-read-panel";
import { useSigner, useWallet } from "@/lib/wallet/provider";
import { getConnection, resolveCluster } from "@/lib/solana/cluster";
import {
  type FlowOutcome,
  type CreateOfferPlan,
  planCreateOffer,
  runCreateOfferFlow,
  type StageName,
} from "@/lib/solana/flows";
import { readProtocolState, type ProtocolRead } from "@/lib/solana/read";
import { PublicKey } from "@solana/web3.js";

const EXPIRY_CHOICES = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
] as const;

function generateOfferId(): bigint {
  return BigInt(Date.now()) * 1_000n + BigInt(Math.floor(Math.random() * 1_000));
}

function signedPercent(bps: number): string {
  const value = bps / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function MakerFlow({ asset }: { asset: PreStockAsset }) {
  const wallet = useWallet();
  const signer = useSigner();

  const [amount, setAmount] = useState("0.25");
  const [offsetBps, setOffsetBps] = useState(-300);
  const [expiryHours, setExpiryHours] = useState(24);
  const [offerId, setOfferId] = useState<bigint>(() => generateOfferId());
  const [read, setRead] = useState<ProtocolRead | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageName | null>(null);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);
  const [executedPlan, setExecutedPlan] = useState<CreateOfferPlan | null>(null);

  const cluster = useMemo(() => resolveCluster(), []);
  const isFlagship = asset.mint === MARKDESK_FLAGSHIP_MINT;
  const isScaled = asset.mint === PRESTOCKS_MINTS.OPENAI || asset.mint === PRESTOCKS_MINTS.SPACEX;
  const hasMigrationDeadline = asset.mint === PRESTOCKS_MINTS.SPACEX;
  const baseDecimals = read?.baseMint?.decimals ?? 9;
  const quoteDecimals = read?.quoteMint?.decimals ?? 6;
  const quoteSymbol = "USDC";

  const refreshRead = useCallback(
    async (walletKey: PublicKey | null) => {
      setReading(true);
      setReadError(null);
      try {
        const next = await readProtocolState({
          connection: getConnection(),
          cluster,
          baseMint: new PublicKey(asset.mint),
          wallet: walletKey,
        });
        setRead(next);
      } catch (error) {
        setReadError(error instanceof Error ? error.message : "The chain read failed.");
      } finally {
        setReading(false);
      }
    },
    [asset.mint, cluster],
  );

  useEffect(() => {
    if (!wallet.publicKey) {
      setRead(null);
      return;
    }
    void refreshRead(wallet.publicKey);
  }, [wallet.publicKey, refreshRead]);

  const parsedAmount = useMemo(() => {
    try {
      return parseDecimalToRaw(amount, baseDecimals);
    } catch {
      return null;
    }
  }, [amount, baseDecimals]);

  const planResult = useMemo(() => {
    if (!signer || !read || parsedAmount === null || parsedAmount <= 0n) return null;
    return planCreateOffer({
      read,
      maker: signer.publicKey,
      buyerNetTargetRaw: parsedAmount,
      offsetBps,
      expiresAtSeconds: BigInt(read.nowSeconds + expiryHours * 3_600 + 60),
      offerId,
    });
  }, [signer, read, parsedAmount, offsetBps, expiryHours, offerId]);

  const unitPrice = applyOffsetToPrice(asset.markPrice, offsetBps);

  async function executeCreate(plan: CreateOfferPlan) {
    if (!signer) return;
    setOutcome(null);
    setExecutedPlan(plan);
    try {
      const result = await runCreateOfferFlow({
        connection: getConnection(),
        clusterProgramId: cluster.programId,
        signer,
        plan,
        onStage: (next) => setStage(next),
      });
      setOutcome(result);
      if (result.status === "verified") {
        setOfferId(generateOfferId());
      }
      void refreshRead(signer.publicKey);
    } catch (error) {
      setOutcome({
        status: "failed",
        stage: "verifying",
        error: error instanceof Error ? error.message : "Unexpected execution failure.",
      });
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="flowPanel">
      <div className="selectedAsset">
        <span className="assetMonogram">{asset.symbol.slice(0, 2)}</span>
        <div>
          <strong>{asset.symbol}</strong>
          <span>{asset.name.replace(" PreStocks", "")}</span>
        </div>
        <div className="selectedMark">
          <span>OFFICIAL MARK</span>
          <strong>${asset.markPrice.toFixed(2)}</strong>
        </div>
      </div>

      <div
        className="compatibilityNotice"
        data-level={hasMigrationDeadline ? "critical" : "standard"}
      >
        <strong>
          {hasMigrationDeadline
            ? "LEGACY TOKEN DEADLINE"
            : isFlagship
              ? "FLAGSHIP COMPATIBILITY PATH"
              : "TOKEN-2022 CONTROLS"}
        </strong>
        <span>
          {hasMigrationDeadline
            ? "PreStocks says this SpaceX token must be swapped before March 12, 2027 or it expires worthless."
            : isScaled
              ? "Quotes apply the live scaled-UI multiplier after both transfer-fee legs. Issuer controls still apply."
              : "Settlement re-reads epoch fees, pause state, and issuer-controlled extensions on-chain."}
        </span>
      </div>

      <label className="fieldLabel" htmlFor="amount">
        Buyer receives (target, net of both fee legs)
      </label>
      <div className="amountField">
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={parsedAmount === null}
        />
        <span>{asset.symbol}</span>
      </div>

      <div className="offsetHeading">
        <label className="fieldLabel" htmlFor="offset">
          Offset from mark
        </label>
        <output htmlFor="offset" className={offsetBps <= 0 ? "negative" : "positive"}>
          {signedPercent(offsetBps)}
        </output>
      </div>
      <input
        className="offsetRange"
        id="offset"
        type="range"
        min="-2000"
        max="2000"
        step="25"
        value={offsetBps}
        onChange={(event) => setOffsetBps(Number(event.target.value))}
      />
      <div className="offsetButtons">
        {[-500, -300, 0, 300].map((value) => (
          <button
            type="button"
            key={value}
            className={value === offsetBps ? "active" : ""}
            onClick={() => setOffsetBps(value)}
          >
            {signedPercent(value)}
          </button>
        ))}
      </div>

      <div className="offsetHeading">
        <label className="fieldLabel" htmlFor="expiry">
          Expiry
        </label>
      </div>
      <div className="offsetButtons expiryChoices">
        {EXPIRY_CHOICES.map((choice) => (
          <button
            type="button"
            key={choice.hours}
            className={choice.hours === expiryHours ? "active" : ""}
            onClick={() => setExpiryHours(choice.hours)}
            disabled={!wallet.publicKey}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {wallet.publicKey === null ? (
        <>
          <dl className="quoteSummary">
            <div>
              <dt>Reference mark</dt>
              <dd>${asset.markPrice.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Your unit price</dt>
              <dd>${unitPrice.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Token path</dt>
              <dd>2 fee-aware transfers</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>24 hours</dd>
            </div>
          </dl>
          <p className="composerNotice">
            Connect a wallet to use the read-before-sign console. The console re-reads the epoch
            fee, UI multiplier, pause state, and hook state, simulates, and only then requests a
            signature.
          </p>
        </>
      ) : (
        <>
          <div className="readToolbar">
            <span className="readToolbarLabel">
              CHAIN READ{" "}
              {reading
                ? "· REFRESHING"
                : read
                  ? `· ${new Date(read.readAtMs).toLocaleTimeString("en-US")}`
                  : ""}
            </span>
            <button
              type="button"
              onClick={() => void refreshRead(wallet.publicKey)}
              disabled={reading}
            >
              Re-read chain
            </button>
          </div>
          {readError ? <Blockers items={[readError]} /> : null}
          {read ? (
            <ChainReadPanel read={read} baseSymbol={asset.symbol} quoteSymbol={quoteSymbol} />
          ) : reading ? (
            <p className="composerNotice">Reading program, mark, mint, and balances…</p>
          ) : null}

          {planResult && read ? (
            planResult.ok ? (
              <>
                <dl className="quoteSummary">
                  <div>
                    <dt>
                      Reference mark (on-chain, seq {planResult.plan.markSequence.toString()})
                    </dt>
                    <dd>{formatUsdFromE6(planResult.plan.markPriceE6)}</dd>
                  </div>
                  <div>
                    <dt>Your unit price</dt>
                    <dd>${unitPrice.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Your gross deposit</dt>
                    <dd>
                      {formatRaw(planResult.plan.grossDepositRaw, baseDecimals)} {asset.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Fee leg #1 (maker to vault, withheld)</dt>
                    <dd>{formatRaw(planResult.plan.inboundFeeRaw, baseDecimals)}</dd>
                  </div>
                  <div>
                    <dt>Vault spendable credit</dt>
                    <dd>{formatRaw(planResult.plan.vaultCreditRaw, baseDecimals)}</dd>
                  </div>
                  <div>
                    <dt>Fee leg #2 (vault to buyer, withheld)</dt>
                    <dd>{formatRaw(planResult.plan.outboundFeeRaw, baseDecimals)}</dd>
                  </div>
                  <div>
                    <dt>Buyer net receipt</dt>
                    <dd>
                      {formatRaw(planResult.plan.buyerNetRaw, baseDecimals)} {asset.symbol}
                    </dd>
                  </div>
                  {planResult.plan.uiMultiplier !== 1 ? (
                    <div>
                      <dt>Scaled-UI buyer amount</dt>
                      <dd>
                        {formatRaw(planResult.plan.scaledBuyerRaw, baseDecimals)} (
                        {planResult.plan.uiMultiplier}×)
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Quote estimate at current mark</dt>
                    <dd>
                      {formatRaw(planResult.plan.quoteEstimateRaw, quoteDecimals)} {quoteSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Offer ID / expiry</dt>
                    <dd>
                      {planResult.plan.offerId.toString()} · {expiryHours}h
                    </dd>
                  </div>
                </dl>

                <BoundsCard
                  rows={[
                    {
                      label: "Minimum escrow credit",
                      value: `${formatRaw(planResult.plan.minimumEscrowedAmount, baseDecimals)} ${asset.symbol}`,
                      hint: "If the fee epoch changes and the vault credits less, the program rejects and nothing moves.",
                    },
                  ]}
                  note={
                    <>
                      You will sign <strong>create_offer</strong> after a successful simulation.
                      Offer PDA <code>{planResult.plan.offerAddress.slice(0, 20)}…</code>
                    </>
                  }
                />

                <StageRail active={stage} />

                <button
                  type="button"
                  className="previewButton"
                  disabled={stage !== null}
                  onClick={() => void executeCreate(planResult.plan)}
                >
                  {stage === null
                    ? "Simulate & sign create offer"
                    : stage === "simulating"
                      ? "Simulating…"
                      : stage === "signing"
                        ? "Awaiting signature…"
                        : stage === "sending"
                          ? "Sending…"
                          : stage === "confirming"
                            ? "Confirming…"
                            : "Verifying…"}
                </button>

                {outcome && executedPlan ? (
                  <FlowReceipt outcome={outcome}>
                    {outcome.status === "verified" ? (
                      <div className="receiptOffer">
                        <div>
                          <span>OFFER ID</span>
                          <strong>{executedPlan.offerId.toString()}</strong>
                        </div>
                        <div>
                          <span>OFFER ADDRESS</span>
                          <strong>{executedPlan.offerAddress.slice(0, 16)}…</strong>
                        </div>
                        <CopyButton value={executedPlan.offerAddress} label="COPY ADDRESS" />
                        <CopyButton
                          value={`${typeof window !== "undefined" ? window.location.origin : ""}/?offer=${executedPlan.offerAddress}#market`}
                          label="COPY OFFER LINK"
                        />
                      </div>
                    ) : null}
                  </FlowReceipt>
                ) : null}

                <p className="composerNotice">
                  <Clock /> Fill rejects marks older than the configured maximum age and a different
                  mark sequence than the one signed here.
                </p>
              </>
            ) : (
              <>
                <Blockers items={planResult.blockers} />
                <p className="composerNotice">
                  Execution stays disabled until every blocker clears. This is the honest state of
                  the cluster, not a bug.
                </p>
              </>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
