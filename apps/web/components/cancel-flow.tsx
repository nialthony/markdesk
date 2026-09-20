"use client";

import { PublicKey } from "@solana/web3.js";
import { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, Shield } from "./icons";
import { Blockers, BoundsCard, FlowReceipt, StageRail, formatAge, formatRaw } from "./flow-shared";
import { useSigner, useWallet } from "@/lib/wallet/provider";
import { getConnection, resolveCluster, shortAddress } from "@/lib/solana/cluster";
import {
  type CancelOfferPlan,
  type FlowOutcome,
  type StageName,
  planCancelOffer,
  runCancelOfferFlow,
} from "@/lib/solana/flows";
import { readOfferState, type OfferRead } from "@/lib/solana/read";

export function CancelFlow() {
  const wallet = useWallet();
  const signer = useSigner();

  const [offerInput, setOfferInput] = useState("");
  const [read, setRead] = useState<OfferRead | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageName | null>(null);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);

  const cluster = useMemo(() => resolveCluster(), []);

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

  const planResult = useMemo(() => {
    if (!signer || !read) return null;
    return planCancelOffer({ read, maker: signer.publicKey });
  }, [signer, read]);

  const baseDecimals = read?.baseMint?.decimals ?? 9;

  async function executeCancel(plan: CancelOfferPlan) {
    if (!signer) return;
    setOutcome(null);
    try {
      const result = await runCancelOfferFlow({
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
      <label className="fieldLabel" htmlFor="cancelOfferAddress">
        Your offer address
      </label>
      <div className="amountField">
        <input
          id="cancelOfferAddress"
          value={offerInput}
          placeholder="Paste the offer address you created"
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
          <Shield /> Connect the maker wallet to cancel one of your offers. Cancellation returns the
          vault inventory and closes the vault and Offer PDA.
        </p>
      ) : null}

      {read ? (
        <div className="chainRead">
          <div className="chainReadHead">
            <span>OFFER ON {read.cluster.label.toUpperCase()}</span>
            <small>
              Maker {shortAddress(read.offer.maker)} · expires in{" "}
              {formatAge(Number(read.offer.expiresAtSeconds) - read.nowSeconds)}
            </small>
          </div>
          <div className="chainReadGrid">
            <div className="readRow">
              <span>Vault inventory</span>
              <strong>
                {read.vault.amountRaw !== null
                  ? formatRaw(read.vault.amountRaw, baseDecimals)
                  : "missing"}
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
          </div>
        </div>
      ) : null}

      {planResult ? (
        planResult.ok ? (
          <>
            <dl className="quoteSummary">
              <div>
                <dt>Gross return transfer</dt>
                <dd>{formatRaw(planResult.plan.grossReturnRaw, baseDecimals)}</dd>
              </div>
              <div>
                <dt>Return fee (withheld in your account)</dt>
                <dd>{formatRaw(planResult.plan.returnFeeRaw, baseDecimals)}</dd>
              </div>
              <div>
                <dt>Your net return</dt>
                <dd>{formatRaw(planResult.plan.netReturnRaw, baseDecimals)}</dd>
              </div>
            </dl>

            <BoundsCard
              rows={[
                {
                  label: "Minimum net return",
                  value: formatRaw(planResult.plan.minimumReturnRaw, baseDecimals),
                  hint: "If the fee epoch changes and your net return shrinks, the program rejects and the offer stays open.",
                },
              ]}
              note={
                <>
                  You will sign <strong>cancel_offer</strong> after a successful simulation.
                </>
              }
            />

            <StageRail active={stage} />

            <button
              type="button"
              className="previewButton"
              disabled={stage !== null}
              onClick={() => void executeCancel(planResult.plan)}
            >
              {stage === null
                ? "Simulate & sign cancel"
                : stage === "simulating"
                  ? "Simulating…"
                  : stage === "signing"
                    ? "Awaiting signature…"
                    : stage === "sending"
                      ? "Sending…"
                      : stage === "confirming"
                        ? "Confirming…"
                        : "Verifying…"}{" "}
              <ArrowUpRight />
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
