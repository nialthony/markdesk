import { ArrowUpRight } from "@/components/icons";
import { Logo } from "@/components/logo";
import { MarketBoard } from "@/components/market-board";
import { WalletDock } from "@/components/wallet-dock";
import { getMarketCatalog } from "@/lib/catalog";

export default async function Home() {
  const catalog = await getMarketCatalog();
  const largestGap = [...catalog.assets].sort(
    (a, b) => Math.abs(b.premiumBps) - Math.abs(a.premiumBps),
  )[0];
  const averageGap =
    catalog.assets.reduce((sum, asset) => sum + Math.abs(asset.premiumBps), 0) /
    Math.max(catalog.assets.length, 1) /
    100;

  return (
    <main id="top">
      <nav className="nav shell">
        <Logo />
        <div className="navLinks">
          <a href="#market">Market</a>
          <a href="#protocol">Protocol</a>
          <a href="#build-status">Build status</a>
        </div>
        <div className="navRight">
          <WalletDock />
          <a className="navCta" href="#market">
            Open the board
          </a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="heroCopy">
          <p className="eyebrow">Stocklana 2026 / protocol bootstrap</p>
          <h1>
            Price off the mark.
            <br />
            <em>Settle on-chain.</em>
          </h1>
          <p className="heroLead">
            Mark-relative OTC orders for tokenized private markets. Makers quote a premium or
            discount from the latest official mark; the program enforces freshness and settles
            atomically.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#market">
              Open the board
            </a>
            <a className="textButton" href="#protocol">
              Read the protocol
            </a>
          </div>
        </div>

        <div className="heroSignal" aria-label="Market dislocation summary">
          <div className="signalTop">
            <span>MARK / TOKEN DISLOCATION</span>
            <span>{catalog.source === "live" ? "LIVE" : "SNAPSHOT"}</span>
          </div>
          <div className="signalAsset">
            <div className="signalOrb">{largestGap?.symbol.slice(0, 2) ?? "MD"}</div>
            <div>
              <span>LARGEST ABSOLUTE BASIS</span>
              <strong>{largestGap?.symbol ?? "n/a"}</strong>
            </div>
            <b>
              {largestGap
                ? `${largestGap.premiumBps > 0 ? "+" : ""}${(largestGap.premiumBps / 100).toFixed(2)}%`
                : "n/a"}
            </b>
          </div>
          <div className="signalTrack">
            <span
              style={{ width: `${Math.min(Math.abs(largestGap?.premiumBps ?? 0) / 35, 100)}%` }}
            />
          </div>
          <div className="signalStats">
            <div>
              <span>ASSETS TRACKED</span>
              <strong>{catalog.assets.length.toString().padStart(2, "0")}</strong>
            </div>
            <div>
              <span>AVG. ABS BASIS</span>
              <strong>{averageGap.toFixed(2)}%</strong>
            </div>
            <div>
              <span>SETTLEMENT</span>
              <strong>SOLANA</strong>
            </div>
          </div>
          <p>Reference data is informational. Mark publisher trust remains explicit.</p>
        </div>
      </section>

      <div className="ticker" aria-label="Protocol properties">
        <div>
          <span>MARK-RELATIVE PRICING</span>
          <i>/</i>
          <span>ATOMIC USDC SETTLEMENT</span>
          <i>/</i>
          <span>FRESHNESS ENFORCED</span>
          <i>/</i>
          <span>PRESTOCKS-ONLY WEDGE</span>
          <i>/</i>
          <span>ESCROW YOU CAN AUDIT</span>
        </div>
      </div>

      <div className="shell">
        <MarketBoard catalog={catalog} />
      </div>

      <section className="protocol shell" id="protocol">
        <div className="protocolIntro">
          <p className="sectionKicker">ONE RULE, END TO END</p>
          <h2>Execution with a reference.</h2>
          <p>
            Fixed-dollar orders go stale. MarkDesk stores the economic intent, an offset from a
            timestamped mark, and lets the program enforce the rest.
          </p>
        </div>
        <div className="protocolSteps">
          <article>
            <span className="stepNumber">01</span>
            <h3>Publish the mark</h3>
            <p>
              An authorized publisher normalizes the official source into integer micro-dollars.
            </p>
          </article>
          <article>
            <span className="stepNumber">02</span>
            <h3>Escrow the offer</h3>
            <p>
              The maker chooses amount, basis-point offset, and expiry. The Offer PDA controls
              custody.
            </p>
          </article>
          <article>
            <span className="stepNumber">03</span>
            <h3>Settle atomically</h3>
            <p>A fresh mark prices the fill. Base token and USDC move together or nothing moves.</p>
          </article>
        </div>
      </section>

      <section className="truth shell" id="build-status">
        <div className="truthCard">
          <p className="sectionKicker">TRUST, MADE VISIBLE</p>
          <h2>Atomic does not mean oracle-free.</h2>
          <p>
            Version one trusts a configured publisher to reproduce the PreStocks API. The program
            guarantees authorization, monotonic sequence, freshness, offer terms, and settlement,
            not the economic truth of the source itself.
          </p>
          <div className="truthLinks">
            <a href="https://prestocks.com/api/prestocks" target="_blank" rel="noreferrer">
              Source API <ArrowUpRight />
            </a>
            <a
              href="https://hackathons.solana.com/hackathons/stocklana"
              target="_blank"
              rel="noreferrer"
            >
              Stocklana brief <ArrowUpRight />
            </a>
          </div>
        </div>
        <div className="statusCard">
          <div className="statusHeader">
            <span>BUILD STATUS</span>
            <span>BOOTSTRAP / 0.1</span>
          </div>
          {[
            ["Eight-mint extension audit", "DONE"],
            ["Fee + scaled-UI quote engine", "TESTED"],
            ["Withheld-fee vault closure", "CODED"],
            ["Anchor settlement core", "SBF-TESTED"],
            ["Wallet transaction flows", "CLIENT-READY"],
            ["Devnet bootstrap + flow-check", "SCRIPTED"],
            ["Devnet two-wallet test", "PASSED"],
          ].map(([label, status]) => (
            <div className="statusRow" key={label}>
              <span>{label}</span>
              <strong data-status={status}>{status}</strong>
            </div>
          ))}
          <p>
            Success renders only after confirmed balances and closed accounts are re-read on-chain.
            The devnet two-wallet run (create to fill, then create to cancel) passed on 2026-09-21
            with every step verified on-chain (program
            61Vm7fAF4yfSW3oJDpmKw9rVdjAi82unzzof656teGUw).
          </p>
        </div>
      </section>

      <footer className="footer shell">
        <Logo />
        <p>Built in public for Stocklana. Unaudited prototype. Do not deposit meaningful value.</p>
        <span>SEMARANG / SOLANA / 2026</span>
      </footer>
    </main>
  );
}
