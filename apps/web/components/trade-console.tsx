"use client";

import type { PreStockAsset } from "@markdesk/core";
import { Suspense, useState } from "react";
import { CancelFlow } from "./cancel-flow";
import { MakerFlow } from "./maker-flow";
import { TakerFlow } from "./taker-flow";

type Tab = "sell" | "fill" | "cancel";

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: "sell", label: "Sell", hint: "Maker: escrow at an offset from the mark" },
  { key: "fill", label: "Fill", hint: "Taker: pay USDC for a live offer" },
  { key: "cancel", label: "Cancel", hint: "Maker: recover escrowed inventory" },
];

/**
 * Execution console. The READ-ONLY PROTOCOL PREVIEW label was lifted on
 * 2026-09-21 after the devnet two-wallet create → fill → cancel run verified
 * on-chain (CI run 35570247328, program 61Vm7fAF4yfSW3oJDpmKw9rVdjAi82unzzof
 * 656teGUw); the flows still render honestly gated on deployed-program and
 * fresh-mark reads.
 */
export function TradeConsole({ asset, assets }: { asset: PreStockAsset; assets: PreStockAsset[] }) {
  const [tab, setTab] = useState<Tab>("sell");

  return (
    <aside className="composer" aria-label="Offer console">
      <div className="composerHeader">
        <div>
          <p className="sectionKicker">OFFER STUDIO / EXECUTION CONSOLE</p>
          <h2>Price to the mark.</h2>
        </div>
        <span
          className="liveBadge"
          title="Devnet two-wallet create to fill to cancel verified on-chain (2026-09-21)."
        >
          LIVE ON DEVNET / READ-WRITE
        </span>
      </div>

      <div className="consoleTabs" role="tablist" aria-label="Offer console flows">
        {TABS.map((entry) => (
          <button
            type="button"
            key={entry.key}
            role="tab"
            aria-selected={tab === entry.key}
            className={tab === entry.key ? "active" : ""}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="consoleTabHint">{TABS.find((entry) => entry.key === tab)?.hint}</p>

      {tab === "sell" ? <MakerFlow asset={asset} /> : null}
      {tab === "fill" ? (
        <Suspense fallback={<p className="composerNotice">Loading offer console…</p>}>
          <TakerFlow assets={assets} />
        </Suspense>
      ) : null}
      {tab === "cancel" ? <CancelFlow /> : null}
    </aside>
  );
}
