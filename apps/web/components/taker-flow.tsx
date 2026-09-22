"use client";

import { PRESTOCKS_MINTS, type PreStockAsset } from "@markdesk/core";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Blockers,
  BoundsCard,
  FlowReceipt,
  StageRail,
  formatAge,
  formatRaw,
  formatUsdFromE6,
} from "./flow-shared";
import { useSigner, useWallet } from "@/lib/wallet/provider";
import { getConnection, resolveCluster, shortAddress } from "@/lib/solana/cluster";
import {
  type FillOfferPlan,
  type FlowOutcome,
  type StageName,
  planFillOffer,
  runFillOfferFlow,
} from "@/lib/solana/flows";
import { readOfferState, type OfferRead } from "@/lib/solana/read";

const MINT_SYMBOLS: ReadonlyMap<string, string> = new Map(
  Object.entries(PRESTOCKS_MINTS).map(([symbol, mint]) => [mint, symbol]),
);

function signedPercent(bps: number): string {
  const value = bps / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function TakerFlow({ assets }: { assets: PreStockAsset[] }) {
  const wallet = useWallet();
  const signer = useSigner();
  const [offerInput, setOfferInput] = useState("");
  const [read, setRead] = useState<OfferRead | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageName | null>(null);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);

  const cluster = useMemo(() => resolveCluster(), []);

  // Read the ?offer= deep link once on mount. Effects only run client-side,
  // so this cannot diverge from the prerendered shell (no useSearchParams CSR
  // bailout, no hydration mismatch when the link opens with a param).
  useEffect(() => {
    const seeded = new URLSearchParams(window.location.search).get("offer");
    if (seeded) setOfferInput(seeded);
  }, []);

  const loadOffer = useCallback(
    async (address: string, walletKey: PublicKey | null) => {
      let key: PublicKey;
      try {
        key = new PublicKey(address.trim());
      } catch {
        setReadError("That is not a valid Solana address.");
        setRead(null);
        return;
      }
      setReading(true);
      setReadError(null);
      try {
        const next = await readOfferState({
          connection: getConnection(),
          cluster,
          offer: key,
          wallet: walletKey,
        });
        if (!next) {
          setRead(null);
          setReadError("No offer account exists at that address on this cluster.");
        } else {
          setRead(next);
          setOutcome(null);
        }
      } catch (error) {
        setReadError(error instanceof Error ? error.message : "The offer read failed.");
      } finally {
        setReading(false);
      }
    },
    [cluster],
  );

  // Load a ?offer=… deep link as soon as a wallet connects.
  const [autoLoaded, setAutoLoaded] = useState(false);
  useEffect(() => {
    if (autoLoaded || !wallet.publicKey || offerInput.length === 0) return;
    setAutoLoaded(true);
    void loadOffer(offerInput, wallet.publicKey);
  }, [autoLoaded, wallet.publicKey, offerInput, loadOffer]);

  const planResult = useMemo(() => {
    if (!signer || !read) return null;
    return planFillOffer({ read, taker: signer.publicKey });
  }, [signer, read]);

  const baseSymbol = read ? (MINT_SYMBOLS.get(read.offer.baseMint) ?? "TOKEN") : "TOKEN";
  const assetName =
    assets.find((asset) => asset.mint === read?.offer.baseMint)?.name ?? "Token-2022 base";
  const baseDecimals = read?.baseMint?.decimals ?? 9;
  const quoteDecimals = read?.quoteMint?.decimals ?? 6;

  async function executeFill(plan: FillOfferPlan) {
    if (!signer) return;
    setOutcome(null);
    try {
      const result = await runFillOfferFlow({
        connection: getConnection(),
        clusterProgramId: cluster.programId,
        signer,
        plan,
        onStage: (next) => setStage(next),
      });
      setOutcome(result);
      void loadOffer(offerInput, signer.publicKey);
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
      <label className="fieldLabel" htmlFor="offerAddress">
        Offer address
      </label>
      <div className="amountField">
        <input
          id="offerAddress"
          value={offerInput}
          placeholder="Paste the offer address from the maker's receipt"
          onChange={(event) => setOfferInput(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="readToolbar">
        <span className="readToolbarLabel">
          {reading
            ? "READING OFFER…"
            : read
              ? `READ ${new Date(read.readAtMs).toLocaleTimeString("en-US")}`
              : "OFFER READ"}
        </span>
        <button
          type="button"
          onClick={() => void loadOffer(offerInput, wallet.publicKey)}
          disabled={reading || offerInput.trim().length === 0}
        >
          Read offer
        </button>
      </div>

      {readError ? <Blockers items={[readError]} /> : null}
      {wallet.publicKey === null ? (
        <p className="composerNotice">
          Connect a wallet to review and fill an offer. Filling prices the buyer&apos;s net receipt
          against a fresh on-chain mark and pays the maker in USDC atomically.
        </p>
      ) : null}

      {read ? (
        <div className="chainRead">
          <div className="chainReadHead">
            <span>OFFER ON {read.cluster.label.toUpperCase()}</span>
            <small>
              ID {read.offer.offerId.toString()} · expires in{" "}
              {formatAge(Number(read.offer.expiresAtSeconds) - read.nowSeconds)}
            </small>
          </div>
          <div className="chainReadGrid">
            <div className="readRow">
              <span>Maker</span>
              <strong>{shortAddress(read.offer.maker)}</strong>
            </div>
            <div className="readRow">
              <span>Base asset</span>
              <strong>
                {baseSymbol} · {assetName.replace(" PreStocks", "")}
              </strong>
            </div>
            <div className="readRow">
              <span>Offset from mark</span>
              <strong>{signedPercent(read.offer.offsetBps)}</strong>
            </div>
            <div className="readRow" data-state="ok">
              <span>Vault inventory (gross to you)</span>
              <strong>
                {read.vault.amountRaw !== null
                  ? formatRaw(read.vault.amountRaw, baseDecimals)
                  : "missing"}
              </strong>
            </div>
            <div className="readRow" data-state={read.mark?.fresh ? "ok" : "bad"}>
              <span>Mark</span>
              <strong>
                {read.mark
                  ? `${formatUsdFromE6(read.mark.priceE6)} · seq ${read.mark.sequence.toString()} · ${formatAge(read.mark.ageSeconds)} old`
                  : "not published"}
              </strong>
            </div>
            <div className="readRow">
              <span>Active fee epoch</span>
              <strong>
                {read.baseMint?.fee.current
                  ? `${read.baseMint.fee.current.basisPoints} bps`
                  : "none"}
              </strong>
            </div>
            <div className="readRow">
              <span>Active UI multiplier</span>
              <strong>
                {read.baseMint?.scaledUi ? `${read.baseMint.scaledUi.activeMultiplier}×` : "1×"}
              </strong>
            </div>
            <div className="readRow">
              <span>Your USDC balance</span>
              <strong>
                {read.wallet?.quote
                  ? read.wallet.quote.amountRaw === null
                    ? "no token account"
                    : formatRaw(read.wallet.quote.amountRaw, quoteDecimals)
                  : "n/a"}
              </strong>
            </div>
          </div>
        </div>
      ) : null}

      {planResult ? (
        planResult.ok ? (
          <>
            <dl className="quoteSummary">
              <div>
                <dt>Gross base leaving the vault</dt>
                <dd>{formatRaw(planResult.plan.grossBaseRaw, baseDecimals)}</dd>
              </div>
              <div>
                <dt>Fee leg #2 (withheld in your account)</dt>
                <dd>{formatRaw(planResult.plan.outboundFeeRaw, baseDecimals)}</dd>
              </div>
              <div>
                <dt>Your net base receipt</dt>
                <dd>
                  {formatRaw(planResult.plan.buyerNetRaw, baseDecimals)} {baseSymbol}
                </dd>
              </div>
              {planResult.plan.uiMultiplier !== 1 ? (
                <div>
                  <dt>Scaled-UI amount priced</dt>
                  <dd>
                    {formatRaw(planResult.plan.scaledBuyerRaw, baseDecimals)} (
                    {planResult.plan.uiMultiplier}×)
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Your exact USDC debit</dt>
                <dd>{formatRaw(planResult.plan.quoteAmountRaw, quoteDecimals)} USDC</dd>
              </div>
              <div>
                <dt>Maker receives</dt>
                <dd>{formatRaw(planResult.plan.quoteAmountRaw, quoteDecimals)} USDC</dd>
              </div>
            </dl>

            <BoundsCard
              rows={[
                {
                  label: "Expected mark sequence",
                  value: planResult.plan.expectedMarkSequence.toString(),
                  hint: "A newer mark between now and execution rejects the fill.",
                },
                {
                  label: "Minimum buyer net",
                  value: `${formatRaw(planResult.plan.minimumBuyerNetRaw, baseDecimals)} ${baseSymbol}`,
                  hint: "If fee changes shrink your net receipt, nothing moves.",
                },
                {
                  label: "Maximum USDC debit",
                  value: `${formatRaw(planResult.plan.maximumQuoteRaw, quoteDecimals)} USDC`,
                  hint: "You can never pay more than this signed ceiling.",
                },
              ]}
              note={
                <>
                  You will sign <strong>fill_offer</strong> after a successful simulation.
                </>
              }
            />

            <StageRail active={stage} />

            <button
              type="button"
              className="previewButton"
              disabled={stage !== null}
              onClick={() => void executeFill(planResult.plan)}
            >
              {stage === null
                ? "Simulate & sign fill"
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

            {outcome ? <FlowReceipt outcome={outcome} /> : null}
          </>
        ) : (
          <Blockers items={planResult.blockers} />
        )
      ) : null}
    </div>
  );
}
