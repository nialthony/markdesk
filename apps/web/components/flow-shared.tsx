"use client";

import { formatRawAmount } from "@markdesk/core";
import { useEffect, useState, type ReactNode } from "react";
import { explorerTransactionUrl, shortAddress } from "@/lib/solana/cluster";
import type { FlowOutcome, StageName } from "@/lib/solana/flows";

const STAGES: Array<{ key: StageName; label: string }> = [
  { key: "reading", label: "READ" },
  { key: "simulating", label: "SIMULATE" },
  { key: "signing", label: "SIGN" },
  { key: "sending", label: "SEND" },
  { key: "confirming", label: "CONFIRM" },
  { key: "verifying", label: "VERIFY" },
];

/** Shows the execution pipeline; every stage must pass before success renders. */
export function StageRail({ active }: { active: StageName | null }) {
  if (active === null) return null;
  const activeIndex = STAGES.findIndex((stage) => stage.key === active);
  return (
    <ol className="stageRail" aria-label="Execution stages">
      {STAGES.map((stage, index) => (
        <li
          key={stage.key}
          data-state={
            active === "verified" || activeIndex > index
              ? "done"
              : index === activeIndex
                ? "active"
                : "idle"
          }
        >
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

export function Blockers({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="blockerList">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export interface BoundRow {
  label: string;
  value: string;
  hint: string;
}

/** The signed execution bounds, shown before any signature is requested. */
export function BoundsCard({ rows, note }: { rows: BoundRow[]; note?: ReactNode }) {
  return (
    <div className="boundsCard">
      <div className="boundsHead">
        <span>SIGNED BOUNDS / REJECTED ON-CHAIN IF VIOLATED</span>
      </div>
      {rows.map((row) => (
        <div className="boundRow" key={row.label}>
          <div>
            <strong>{row.label}</strong>
            <span>{row.hint}</span>
          </div>
          <b>{row.value}</b>
        </div>
      ))}
      {note ? <p className="boundsNote">{note}</p> : null}
    </div>
  );
}

/**
 * Copies text where the async Clipboard API is policy-blocked (embedded
 * previews, iframes without clipboard-write) by falling back to the legacy
 * execCommand path. Returns whether the value actually reached the clipboard.
 */
async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // NotAllowedError et al.: fall through to the legacy path.
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <span className="copyWrap">
      <button
        type="button"
        className="copyButton"
        onClick={() => {
          void copyText(value).then((copied) => setState(copied ? "copied" : "blocked"));
        }}
      >
        {state === "copied" ? "COPIED" : state === "blocked" ? "COPY BLOCKED" : label}
      </button>
      {state === "blocked" ? (
        <input
          className="copyFallback"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={`${label.toLowerCase()}, select and copy manually`}
        />
      ) : null}
    </span>
  );
}

export function formatRaw(raw: bigint, decimals: number, maxFraction = 6): string {
  return formatRawAmount(raw, decimals, Math.min(decimals, maxFraction));
}

export function formatUsdFromE6(priceE6: bigint): string {
  return `$${(Number(priceE6) / 1_000_000).toFixed(2)}`;
}

export function formatAge(seconds: number): string {
  if (seconds < 0) return "future";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 129_600) return `${Math.round(seconds / 3_600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

export function shortLog(signature: string): string {
  return shortAddress(signature);
}

/** Success renders only after every balance and closure check passes. */
export function FlowReceipt({ outcome, children }: { outcome: FlowOutcome; children?: ReactNode }) {
  if (outcome.status === "verified") {
    return (
      <div className="receipt" data-status="verified" role="status">
        <div className="receiptHead">
          <span>VERIFIED ON-CHAIN</span>
          {outcome.slot !== null ? (
            <small>SLOT {outcome.slot.toLocaleString("en-US")}</small>
          ) : null}
        </div>
        <a
          className="receiptTx"
          href={explorerTransactionUrl(outcome.signature)}
          target="_blank"
          rel="noreferrer"
        >
          {shortLog(outcome.signature)} ↗
        </a>
        <ul className="checkList">
          {outcome.checks.map((check) => (
            <li key={check.label} data-ok={check.ok}>
              <b>{check.ok ? "✓" : "✗"}</b>
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </li>
          ))}
        </ul>
        {children}
      </div>
    );
  }

  if (outcome.status === "mismatch") {
    return (
      <div className="receipt" data-status="mismatch" role="alert">
        <div className="receiptHead">
          <span>CONFIRMED / VERIFICATION FAILED</span>
          {outcome.slot !== null ? (
            <small>SLOT {outcome.slot.toLocaleString("en-US")}</small>
          ) : null}
        </div>
        <p className="receiptCopy">
          The transaction is on-chain but at least one re-read did not match the plan. Treat the
          receipt below as unproven and inspect the signature.
        </p>
        <a
          className="receiptTx"
          href={explorerTransactionUrl(outcome.signature)}
          target="_blank"
          rel="noreferrer"
        >
          {shortLog(outcome.signature)} ↗
        </a>
        <ul className="checkList">
          {outcome.checks.map((check) => (
            <li key={check.label} data-ok={check.ok}>
              <b>{check.ok ? "✓" : "✗"}</b>
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (outcome.status === "unconfirmed") {
    return (
      <div className="receipt" data-status="unconfirmed" role="alert">
        <div className="receiptHead">
          <span>SENT / NOT CONFIRMED</span>
        </div>
        <p className="receiptCopy">
          {outcome.detail} The transaction may still land; check the explorer before resubmitting.
        </p>
        <a
          className="receiptTx"
          href={explorerTransactionUrl(outcome.signature)}
          target="_blank"
          rel="noreferrer"
        >
          {shortLog(outcome.signature)} ↗
        </a>
      </div>
    );
  }

  return (
    <div className="receipt" data-status="failed" role="alert">
      <div className="receiptHead">
        <span>FAILED / {outcome.stage.toUpperCase()}</span>
      </div>
      <p className="receiptCopy">{outcome.error}</p>
      {outcome.signature ? (
        <a
          className="receiptTx"
          href={explorerTransactionUrl(outcome.signature)}
          target="_blank"
          rel="noreferrer"
        >
          {shortLog(outcome.signature)} ↗
        </a>
      ) : null}
      {outcome.logs && outcome.logs.length > 0 ? (
        <details className="receiptLogs">
          <summary>Program logs</summary>
          <pre>{outcome.logs.join("\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}
