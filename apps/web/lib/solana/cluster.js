import { MARKDESK_PROGRAM_ID_PLACEHOLDER } from "@markdesk/core";
import { Connection, PublicKey } from "@solana/web3.js";
const DEFAULT_ENDPOINTS = {
    devnet: "https://api.devnet.solana.com",
    localnet: "http://127.0.0.1:8899",
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
};
const CLUSTER_LABELS = {
    devnet: "Devnet",
    localnet: "Localnet",
    "mainnet-beta": "Mainnet-beta",
};
function parseClusterName(value) {
    return value === "localnet" || value === "mainnet-beta" ? value : "devnet";
}
/**
 * Cluster-aware RPC resolution. `NEXT_PUBLIC_SOLANA_CLUSTER` selects the
 * target network, `NEXT_PUBLIC_SOLANA_RPC_URL` overrides the endpoint, and
 * `NEXT_PUBLIC_MARKDESK_PROGRAM_ID` overrides the deployed program. Values are
 * baked in at build time by Next.js.
 */
export function resolveCluster() {
    const name = parseClusterName(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
    const configuredRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
    const endpoint = configuredRpc && configuredRpc.length > 0 ? configuredRpc : DEFAULT_ENDPOINTS[name];
    const explorerQuery = name === "devnet"
        ? "?cluster=devnet"
        : name === "localnet"
            ? `?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`
            : "";
    const configuredProgram = process.env.NEXT_PUBLIC_MARKDESK_PROGRAM_ID?.trim();
    const programId = configuredProgram && configuredProgram.length > 0
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
let cachedConnection = null;
let cachedEndpoint = null;
export function getConnection() {
    const endpoint = resolveCluster().endpoint;
    if (cachedConnection === null || cachedEndpoint !== endpoint) {
        cachedConnection = new Connection(endpoint, "confirmed");
        cachedEndpoint = endpoint;
    }
    return cachedConnection;
}
export function explorerAddressUrl(address) {
    return `https://explorer.solana.com/address/${address}${resolveCluster().explorerQuery}`;
}
export function explorerTransactionUrl(signature) {
    return `https://explorer.solana.com/tx/${signature}${resolveCluster().explorerQuery}`;
}
export function shortAddress(address) {
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
