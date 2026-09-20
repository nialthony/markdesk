"use client";

import type { ProtocolRead } from "@/lib/solana/read";
import { formatAge, formatRaw, formatUsdFromE6 } from "./flow-shared";

function Row({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state?: "ok" | "bad" | "warn";
}) {
  return (
    <div className="readRow" data-state={state}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Read-before-sign surface: every value is re-read from the cluster when the
 * panel refreshes, never assumed from the market board.
 */
export function ChainReadPanel({
  read,
  baseSymbol,
  quoteSymbol,
}: {
  read: ProtocolRead;
  baseSymbol: string;
  quoteSymbol: string;
}) {
  const mark = read.mark;
  const mint = read.baseMint;
  const fee = mint?.fee ?? null;
  const scaled = mint?.scaledUi ?? null;

  return (
    <div className="chainRead">
      <div className="chainReadHead">
        <span>CHAIN READ — {read.cluster.label.toUpperCase()}</span>
        <small>
          EPOCH {read.epoch.toString()} · SLOT READ{" "}
          {new Date(read.readAtMs).toLocaleTimeString("en-US")}
        </small>
      </div>

      <div className="chainReadGrid">
        <Row
          label="Program"
          value={read.programDeployed ? "deployed" : "not deployed"}
          state={read.programDeployed ? "ok" : "bad"}
        />
        <Row
          label="On-chain mark"
          value={
            mark
              ? `${formatUsdFromE6(mark.priceE6)} · seq ${mark.sequence.toString()}`
              : "not published"
          }
          state={mark ? (mark.fresh ? "ok" : "bad") : "bad"}
        />
        <Row
          label="Mark age"
          value={
            mark
              ? `${formatAge(mark.ageSeconds)} (max ${read.config?.maxMarkAgeSeconds ?? "?"}s)`
              : "—"
          }
          state={mark ? (mark.fresh ? "ok" : "bad") : "bad"}
        />
        <Row
          label={`Fee epoch (active)`}
          value={fee?.current ? `${fee.current.basisPoints} bps` : "none"}
          state="ok"
        />
        <Row
          label="Fee epoch (scheduled)"
          value={
            fee?.scheduled
              ? `${fee.scheduled.basisPoints} bps @ epoch ${fee.scheduled.epoch.toString()}`
              : "none"
          }
          state={fee?.scheduled ? "warn" : "ok"}
        />
        <Row
          label="UI multiplier (active)"
          value={scaled ? `${scaled.activeMultiplier}×` : "1×"}
          state="ok"
        />
        <Row
          label="UI multiplier (pending)"
          value={
            scaled?.pendingMultiplier
              ? `${scaled.pendingMultiplier}× @ ${new Date((scaled.pendingEffectiveAt ?? 0) * 1000).toISOString().slice(0, 10)}`
              : "none"
          }
          state={scaled?.pendingMultiplier ? "warn" : "ok"}
        />
        <Row
          label="Issuer pause"
          value={mint?.pausable ? (mint.pausable.paused ? "PAUSED" : "not paused") : "unsupported"}
          state={mint?.pausable?.paused ? "bad" : "ok"}
        />
        <Row
          label="Transfer hook"
          value={
            mint?.transferHook
              ? mint.transferHook.active
                ? `ACTIVE ${mint.transferHook.programId?.slice(0, 8)}…`
                : "inactive"
              : "none"
          }
          state={mint?.transferHook?.active ? "bad" : "ok"}
        />
        <Row
          label="Issuer controls"
          value={`${mint?.permanentDelegate ? "delegate" : "no delegate"} · ${
            mint?.freezeAuthority ? "freeze authority" : "no freeze authority"
          }`}
          state="warn"
        />
        <Row
          label={`Your ${baseSymbol} balance`}
          value={
            read.wallet?.base
              ? read.wallet.base.amountRaw === null
                ? "no token account"
                : `${formatRaw(read.wallet.base.amountRaw, mint?.decimals ?? 9)} ${baseSymbol}`
              : "—"
          }
          state={read.wallet?.base?.amountRaw ? "ok" : "warn"}
        />
        <Row
          label={`Your ${quoteSymbol} balance`}
          value={
            read.wallet?.quote
              ? read.wallet.quote.amountRaw === null
                ? "no token account"
                : formatRaw(read.wallet.quote.amountRaw, read.quoteMint?.decimals ?? 6)
              : "—"
          }
          state={read.wallet?.quote?.amountRaw ? "ok" : "warn"}
        />
      </div>

      <p className="chainReadNote">
        Every execution re-reads these values, simulates the full transaction, and only then asks
        your wallet for a signature.
      </p>
    </div>
  );
}
