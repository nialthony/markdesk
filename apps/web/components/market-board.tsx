"use client";

import { MARKDESK_FLAGSHIP_MINT, type MarketCatalog, type PreStockAsset } from "@markdesk/core";
import { useMemo, useState } from "react";
import { ArrowUpRight } from "./icons";
import { OrderComposer } from "./order-composer";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type Filter = "all" | "premium" | "discount";

function basisLabel(bps: number): string {
  const value = bps / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 5)}…${mint.slice(-4)}`;
}

export function MarketBoard({ catalog }: { catalog: MarketCatalog }) {
  const initial =
    catalog.assets.find((asset) => asset.mint === MARKDESK_FLAGSHIP_MINT) ?? catalog.assets[0];
  const [selectedSymbol, setSelectedSymbol] = useState(initial?.symbol ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.assets.filter((asset) => {
      const matchesQuery =
        needle.length === 0 ||
        asset.symbol.toLowerCase().includes(needle) ||
        asset.name.toLowerCase().includes(needle);
      const matchesFilter =
        filter === "all" ||
        (filter === "premium" && asset.premiumBps > 0) ||
        (filter === "discount" && asset.premiumBps < 0);
      return matchesQuery && matchesFilter;
    });
  }, [catalog.assets, filter, query]);

  const selected =
    catalog.assets.find((asset) => asset.symbol === selectedSymbol) ?? catalog.assets[0];

  return (
    <section className="marketSection" id="market">
      <div className="sectionHeading">
        <div>
          <p className="sectionKicker">LIVE REFERENCE BOARD</p>
          <h2>Private markets, measured.</h2>
        </div>
        <div className="sourcePill" data-source={catalog.source}>
          <span /> {catalog.label}
        </div>
      </div>

      <div className="marketLayout">
        <div className="marketPanel">
          <div className="marketTools">
            <label className="searchField">
              <span>⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company or symbol"
                aria-label="Search company or symbol"
              />
            </label>
            <div className="filterTabs" aria-label="Market filter">
              {(["all", "premium", "discount"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="marketTable" role="table" aria-label="PreStocks reference prices">
            <div className="marketTableHead" role="row">
              <span>ASSET</span>
              <span>MARK</span>
              <span>TOKEN</span>
              <span>BASIS</span>
              <span>MARK VAL.</span>
              <span aria-hidden="true" />
            </div>
            <div className="marketRows">
              {visible.map((asset) => (
                <MarketRow
                  key={asset.mint}
                  asset={asset}
                  selected={asset.symbol === selected?.symbol}
                  onSelect={() => setSelectedSymbol(asset.symbol)}
                />
              ))}
              {visible.length === 0 ? (
                <div className="noResults">No assets match this view.</div>
              ) : null}
            </div>
          </div>

          <div className="marketFootnote">
            <span>Snapshot: {catalog.observedAt.replace("T", " ").slice(0, 19)} UTC</span>
            <a href={catalog.sourceUrl} target="_blank" rel="noreferrer">
              Inspect source <ArrowUpRight size={14} />
            </a>
          </div>
        </div>

        {selected ? <OrderComposer key={selected.symbol} asset={selected} /> : null}
      </div>
    </section>
  );
}

function MarketRow({
  asset,
  selected,
  onSelect,
}: {
  asset: PreStockAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="marketRow"
      data-selected={selected}
      onClick={onSelect}
      role="row"
    >
      <span className="companyCell" role="cell">
        <span className="assetMonogram small">{asset.symbol.slice(0, 2)}</span>
        <span>
          <strong>{asset.symbol}</strong>
          <small>{shortMint(asset.mint)}</small>
        </span>
      </span>
      <span className="numericCell" role="cell">
        <strong>{usd.format(asset.markPrice)}</strong>
        <small>reference</small>
      </span>
      <span className="numericCell" role="cell">
        <strong>{usd.format(asset.tokenPrice)}</strong>
        <small>on-chain</small>
      </span>
      <span
        className="basisCell"
        data-direction={asset.premiumBps >= 0 ? "up" : "down"}
        role="cell"
      >
        {basisLabel(asset.premiumBps)}
      </span>
      <span className="numericCell valuation" role="cell">
        <strong>{compactUsd.format(asset.markValuation)}</strong>
        <small>marked</small>
      </span>
      <span className="rowArrow" role="cell">
        →
      </span>
    </button>
  );
}
