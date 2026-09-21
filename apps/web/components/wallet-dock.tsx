"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/provider";
import { resolveCluster, shortAddress } from "@/lib/solana/cluster";

/** Nav-level cluster badge, connect button, and wallet menu. */
export function WalletDock() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cluster = useMemo(() => resolveCluster(), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="walletDock" ref={containerRef}>
      <span className="clusterPill" data-cluster={cluster.name}>
        <span /> {cluster.label.toUpperCase()}
      </span>

      {wallet.publicKey === null ? (
        <div className="walletMenuAnchor">
          <button
            type="button"
            className="walletConnectButton"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            disabled={wallet.connecting}
          >
            {wallet.connecting ? "CONNECTING…" : "CONNECT WALLET"}
          </button>
          {open ? (
            <div className="walletMenu" role="menu">
              {wallet.wallets.length === 0 ? (
                <p className="walletMenuEmpty">
                  No Wallet Standard wallets detected. Install Phantom or Solflare, then reload.
                </p>
              ) : (
                wallet.wallets.map((detected) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={detected.name}
                    onClick={() => {
                      setOpen(false);
                      void wallet.connect(detected).catch(() => undefined);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={detected.icon} alt="" width={18} height={18} />
                    <span>{detected.name}</span>
                    {!detected.canSignTransactions ? <small>VIEW ONLY</small> : null}
                  </button>
                ))
              )}
              <p className="walletMenuNote">
                Ensure the wallet is set to <strong>{cluster.label}</strong>. Transactions are
                simulated before any signature is requested.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="walletIdentity">
          <span className="walletDot" />
          <strong>{shortAddress(wallet.publicKey.toBase58())}</strong>
          <button type="button" onClick={() => void wallet.disconnect()}>
            DISCONNECT
          </button>
        </div>
      )}
      {wallet.error ? <span className="walletError">{wallet.error}</span> : null}
    </div>
  );
}
