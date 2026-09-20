import { MARKDESK_PROGRAM_ID_PLACEHOLDER } from "@markdesk/core";
import { Connection, PublicKey } from "@solana/web3.js";

export type ClusterName = "devnet" | "localnet" | "mainnet-beta";

export interface ClusterConfig {
  name: ClusterName;
  label: string;
  endpoint: string;
  /** Query suffix for explorer.solana.com links. */
  explorerQuery: string;
  programId: PublicKey;
  /** True when the RPC endpoint only works on a developer's machine. */
  requiresLocalRpc: boolean;
}

const DEFAULT_ENDPOINTS: Record<ClusterName, string> = {
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const CLUSTER_LABELS: Record<ClusterName, string> = {
  devnet: "Devnet",
  localnet: "Localnet",
  "mainnet-beta": "Mainnet-beta",
};

function parseClusterName(value: string | undefined): ClusterName {
  return value === "localnet" || value === "mainnet-beta" ? value : "devnet";
}

/**
 * Cluster-aware RPC resolution. `NEXT_PUBLIC_SOLANA_CLUSTER` selects the
 * target network, `NEXT_PUBLIC_SOLANA_RPC_URL` overrides the endpoint, and
 * `NEXT_PUBLIC_MARKDESK_PROGRAM_ID` overrides the deployed program. Values are
 * baked in at build time by Next.js.
 */
export function resolveCluster(): ClusterConfig {
  const name = parseClusterName(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
  const configuredRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  const endpoint =
    configuredRpc && configuredRpc.length > 0 ? configuredRpc : DEFAULT_ENDPOINTS[name];

  const explorerQuery =
    name === "devnet"
      ? "?cluster=devnet"
      : name === "localnet"
        ? `?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`
        : "";

  const configuredProgram = process.env.NEXT_PUBLIC_MARKDESK_PROGRAM_ID?.trim();
  const programId =
    configuredProgram && configuredProgram.length > 0
      ? new PublicKey(configuredProgram)
      : new PublicKey(MARKDESK_PROGRAM_ID_PLACEHOLDER);

  return {
    name,
    label: CLUSTER_LABELS[name],
    endpoint,
    explorerQuery,
    programId,
    requiresLocalRpc: name === "localnet",
  };
}

let cachedConnection: Connection | null = null;
let cachedEndpoint: string | null = null;

export function getConnection(): Connection {
  const endpoint = resolveCluster().endpoint;
  if (cachedConnection === null || cachedEndpoint !== endpoint) {
    cachedConnection = new Connection(endpoint, "confirmed");
    cachedEndpoint = endpoint;
  }
  return cachedConnection;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${resolveCluster().explorerQuery}`;
}

export function explorerTransactionUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${resolveCluster().explorerQuery}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
