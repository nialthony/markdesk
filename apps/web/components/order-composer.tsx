"use client";

import { applyOffsetToPrice, type PreStockAsset } from "@markdesk/core";
import { useMemo, useState } from "react";
import { ArrowUpRight, Clock, Shield } from "./icons";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function signedPercent(bps: number): string {
  const value = bps / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function OrderComposer({ asset }: { asset: PreStockAsset }) {
  const [amount, setAmount] = useState("0.25");
  const [offsetBps, setOffsetBps] = useState(-300);
  const [previewed, setPreviewed] = useState(false);

  const estimate = useMemo(() => {
    const parsed = Number(amount);
    const valid = Number.isFinite(parsed) && parsed > 0;
    const unitPrice = applyOffsetToPrice(asset.markPrice, offsetBps);
    return {
      valid,
      amount: valid ? parsed : 0,
      unitPrice,
      total: valid ? parsed * unitPrice : 0,
    };
  }, [amount, asset.markPrice, offsetBps]);

  function updateOffset(value: number) {
    setOffsetBps(value);
    setPreviewed(false);
  }

  return (
    <aside className="composer" aria-label="Offer preview">
      <div className="composerHeader">
        <div>
          <p className="sectionKicker">OFFER STUDIO / SELL</p>
          <h2>Price to the mark.</h2>
        </div>
        <span className="readOnlyBadge">READ-ONLY</span>
      </div>

      <div className="selectedAsset">
        <span className="assetMonogram">{asset.symbol.slice(0, 2)}</span>
        <div>
          <strong>{asset.symbol}</strong>
          <span>{asset.name.replace(" PreStocks", "")}</span>
        </div>
        <div className="selectedMark">
          <span>OFFICIAL MARK</span>
          <strong>{usd.format(asset.markPrice)}</strong>
        </div>
      </div>

      <label className="fieldLabel" htmlFor="amount">
        Amount
      </label>
      <div className="amountField">
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setPreviewed(false);
          }}
          aria-invalid={!estimate.valid}
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
        onChange={(event) => updateOffset(Number(event.target.value))}
      />
      <div className="offsetButtons">
        {[-500, -300, 0, 300].map((value) => (
          <button
            type="button"
            key={value}
            className={value === offsetBps ? "active" : ""}
            onClick={() => updateOffset(value)}
          >
            {signedPercent(value)}
          </button>
        ))}
      </div>

      <dl className="quoteSummary">
        <div>
          <dt>Reference mark</dt>
          <dd>{usd.format(asset.markPrice)}</dd>
        </div>
        <div>
          <dt>Your unit price</dt>
          <dd>{usd.format(estimate.unitPrice)}</dd>
        </div>
        <div>
          <dt>Estimated settlement</dt>
          <dd>{usd.format(estimate.total)} USDC</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>24 hours</dd>
        </div>
      </dl>

      <button
        type="button"
        className="previewButton"
        disabled={!estimate.valid}
        onClick={() => setPreviewed(true)}
      >
        Generate offer brief <ArrowUpRight />
      </button>

      <p className="composerNotice">
        <Shield /> No wallet transaction is enabled in this bootstrap. Exact settlement will use
        mint decimals read on-chain, not this display estimate.
      </p>

      {previewed ? (
        <div className="offerBrief" role="status">
          <div className="offerBriefTop">
            <span>PROTOCOL PREVIEW</span>
            <span className="statusDot">UNSIGNED</span>
          </div>
          <p>
            Sell{" "}
            <strong>
              {amount} {asset.symbol}
            </strong>{" "}
            at the latest fresh mark <strong>{signedPercent(offsetBps)}</strong>, expiring 24 hours
            after creation.
          </p>
          <div className="briefRule">
            <Clock /> Fill rejects marks older than the configured maximum age.
          </div>
        </div>
      ) : null}
    </aside>
  );
}
