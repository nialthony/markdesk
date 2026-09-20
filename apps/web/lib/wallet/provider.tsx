"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Local feature shapes for the Solana Wallet Standard. */
interface ConnectFeature {
  connect(): Promise<void>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface EventsFeature {
  on(event: "change", listener: (properties: unknown) => void): () => void;
}
interface SolanaSignTransactionFeature {
  signTransaction<T extends Transaction>(...transactions: T[]): Promise<T[]>;
}

export interface DetectedWallet {
  wallet: Wallet;
  name: string;
  icon: string;
  canSignTransactions: boolean;
}

export interface WalletState {
  wallets: DetectedWallet[];
  walletName: string | null;
  publicKey: PublicKey | null;
  connecting: boolean;
  error: string | null;
  connect(wallet: DetectedWallet): Promise<void>;
  disconnect(): Promise<void>;
}

const STORAGE_KEY = "markdesk.wallet-name";

const WalletContext = createContext<WalletState | null>(null);

function solanaAccounts(wallet: Wallet): WalletAccount[] {
  return wallet.accounts.filter((account) =>
    account.chains.some((chain) => chain.startsWith("solana:")),
  );
}

function firstSolanaAddress(wallet: Wallet): PublicKey | null {
  const account = solanaAccounts(wallet)[0];
  if (!account) return null;
  try {
    return new PublicKey(account.address);
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeWallet = useRef<Wallet | null>(null);
  const activeUnsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Wallet Standard registration is browser-only; keep this effect client-side.
    const api = getWallets();
    const sync = () => {
      setWallets(
        api
          .get()
          .filter((wallet) => wallet.chains.some((chain) => chain.startsWith("solana:")))
          .map((wallet) => ({
            wallet,
            name: wallet.name,
            icon: wallet.icon,
            canSignTransactions: "solana:signTransaction" in wallet.features,
          })),
      );
    };
    sync();
    const offRegister = api.on("register", sync);
    const offUnregister = api.on("unregister", sync);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const detachActiveWallet = useCallback(() => {
    activeUnsubscribe.current?.();
    activeUnsubscribe.current = null;
    activeWallet.current = null;
  }, []);

  const connect = useCallback(
    async (detected: DetectedWallet) => {
      setConnecting(true);
      setError(null);
      try {
        const connectFeature = detected.wallet.features["standard:connect"] as
          ConnectFeature | undefined;
        if (!connectFeature) throw new Error("This wallet does not support connecting.");
        await connectFeature.connect();

        const key = firstSolanaAddress(detected.wallet);
        if (!key) throw new Error("The wallet did not expose a Solana account.");

        detachActiveWallet();
        activeWallet.current = detected.wallet;
        const events = detected.wallet.features["standard:events"] as EventsFeature | undefined;
        if (events) {
          activeUnsubscribe.current = events.on("change", () => {
            const next = activeWallet.current ? firstSolanaAddress(activeWallet.current) : null;
            setPublicKey(next);
          });
        }

        setWalletName(detected.name);
        setPublicKey(key);
        try {
          window.localStorage.setItem(STORAGE_KEY, detected.name);
        } catch {
          // Private browsing modes may reject storage; selection is not persisted.
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Connecting to the wallet failed.");
        throw cause;
      } finally {
        setConnecting(false);
      }
    },
    [detachActiveWallet],
  );

  const disconnect = useCallback(async () => {
    const wallet = activeWallet.current;
    if (wallet) {
      try {
        const feature = wallet.features["standard:disconnect"] as DisconnectFeature | undefined;
        await feature?.disconnect();
      } catch {
        // A wallet failing to disconnect must not block local cleanup.
      }
    }
    detachActiveWallet();
    setWalletName(null);
    setPublicKey(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, [detachActiveWallet]);

  // Reconnect to a previously selected wallet when it registers.
  useEffect(() => {
    if (publicKey || connecting || wallets.length === 0) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!saved) return;
    const detected = wallets.find((candidate) => candidate.name === saved);
    if (!detected) return;
    const alreadyAuthorized = firstSolanaAddress(detected.wallet);
    if (alreadyAuthorized) {
      void connect(detected).catch(() => undefined);
    }
  }, [wallets, publicKey, connecting, connect]);

  const value = useMemo<WalletState>(
    () => ({ wallets, walletName, publicKey, connecting, error, connect, disconnect }),
    [wallets, walletName, publicKey, connecting, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>.");
  return context;
}

export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

/** Returns a signer bound to the connected wallet, or null when disconnected. */
export function useSigner(): WalletSigner | null {
  const { publicKey, wallets, walletName } = useWallet();

  return useMemo(() => {
    if (!publicKey) return null;
    const detected = wallets.find((candidate) => candidate.name === walletName);
    if (!detected) return null;
    const feature = detected.wallet.features["solana:signTransaction"] as
      SolanaSignTransactionFeature | undefined;
    if (!feature) return null;
    return {
      publicKey,
      signTransaction: async (transaction: Transaction) => {
        const results = await feature.signTransaction(transaction);
        const signed = Array.isArray(results) ? results[0] : transaction;
        return signed ?? transaction;
      },
    };
  }, [publicKey, wallets, walletName]);
}
