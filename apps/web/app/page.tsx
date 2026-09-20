import { ArrowUpRight, Clock, Layers, Shield } from "@/components/icons";
import { Logo } from "@/components/logo";
import { MarketBoard } from "@/components/market-board";
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
        <a className="navCta" href="#market">
          Open board <ArrowUpRight />
        </a>
      </nav>

      <section className="hero shell">
        <div className="heroGrid" aria-hidden="true" />
        <div className="heroCopy">
          <div className="eyebrow">
            <span className="liveDot" /> STOCKLANA 2026 / PROTOCOL BOOTSTRAP
          </div>
          <h1>
            Trade the mark.
            <br />
            <em>Not the noise.</em>
          </h1>
          <p className="heroLead">
            Mark-relative OTC orders for tokenized private markets. Makers define a premium or
            discount; Solana enforces freshness and settles atomically.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#market">
              Explore live marks <ArrowUpRight />
            </a>
            <a className="textButton" href="#protocol">
              How it works <span>↓</span>
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
              <strong>{largestGap?.symbol ?? "—"}</strong>
            </div>
            <b>
              {largestGap
                ? `${largestGap.premiumBps > 0 ? "+" : ""}${(largestGap.premiumBps / 100).toFixed(2)}%`
                : "—"}
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
          <i>◆</i>
          <span>ATOMIC USDC SETTLEMENT</span>
          <i>◆</i>
          <span>FRESHNESS ENFORCED</span>
          <i>◆</i>
          <span>PRESTOCKS-ONLY WEDGE</span>
          <i>◆</i>
          <span>NO HIDDEN CUSTODY</span>
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
            Fixed-dollar orders become stale. MarkDesk stores the economic intent—an offset from a
            timestamped mark—then lets the chain enforce the rest.
          </p>
        </div>
        <div className="protocolSteps">
          <article>
            <span className="stepNumber">01</span>
            <Clock />
            <h3>Publish the mark</h3>
            <p>
              An authorized publisher normalizes the official source into integer micro-dollars.
            </p>
          </article>
          <article>
            <span className="stepNumber">02</span>
            <Layers />
            <h3>Escrow the offer</h3>
            <p>
              The maker chooses amount, basis-point offset, and expiry. The Offer PDA controls
              custody.
            </p>
          </article>
          <article>
            <span className="stepNumber">03</span>
            <Shield />
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
            guarantees authorization, monotonic sequence, freshness, offer terms, and settlement—not
            the economic truth of the source itself.
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
            ["Anchor settlement core", "INITIAL"],
            ["Wallet transaction UI", "NEXT"],
            ["Devnet deployment", "PENDING"],
          ].map(([label, status]) => (
            <div className="statusRow" key={label}>
              <span>{label}</span>
              <strong data-status={status}>{status}</strong>
            </div>
          ))}
          <p>No fake fills. No simulated success presented as on-chain execution.</p>
        </div>
      </section>

      <footer className="footer shell">
        <Logo />
        <p>Built in public for Stocklana. Unaudited prototype—do not deposit meaningful value.</p>
        <span>SEMARANG → SOLANA / 2026</span>
      </footer>
    </main>
  );
}
