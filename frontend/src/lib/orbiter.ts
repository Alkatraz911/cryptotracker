// Orbiter Finance chain registry — mirrors server/src/explorer/providers/orbiter.provider.ts.
// Maps Orbiter's numeric EVM chainId to our Network union (or UNKNOWN for chains
// we don't model natively but still want to display in the graph).
import type { Network } from "./explorers";
import type { GEdge, GNode } from "./graph";

export type BridgeName = string;

export interface OrbiterChain {
  id: string;
  name: string;
  net: Network;
  tx: (h: string) => string;
}

export const ORBITER_CHAINS: OrbiterChain[] = [
  { id: "1",      name: "Ethereum",   net: "ETH",      tx: (h) => `https://etherscan.io/tx/${h}` },
  { id: "42161",  name: "Arbitrum",   net: "ARBITRUM", tx: (h) => `https://arbiscan.io/tx/${h}` },
  { id: "8453",   name: "Base",       net: "BASE",     tx: (h) => `https://basescan.org/tx/${h}` },
  { id: "56",     name: "BSC",        net: "BSC",      tx: (h) => `https://bscscan.com/tx/${h}` },
  { id: "137",    name: "Polygon",    net: "POLYGON",  tx: (h) => `https://polygonscan.com/tx/${h}` },
  { id: "10",     name: "Optimism",   net: "UNKNOWN",  tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  { id: "59144",  name: "Linea",      net: "UNKNOWN",  tx: (h) => `https://lineascan.build/tx/${h}` },
  { id: "324",    name: "zkSync Era", net: "UNKNOWN",  tx: (h) => `https://explorer.zksync.io/tx/${h}` },
  { id: "534352", name: "Scroll",     net: "UNKNOWN",  tx: (h) => `https://scrollscan.com/tx/${h}` },
  { id: "5000",   name: "Mantle",     net: "UNKNOWN",  tx: (h) => `https://explorer.mantle.xyz/tx/${h}` },
];

const BY_ID = new Map(ORBITER_CHAINS.map((c) => [c.id, c]));
const ID_BY_NET = new Map(ORBITER_CHAINS.filter((c) => c.net !== "UNKNOWN").map((c) => [c.net, c.id]));

export function chainById(id: string): OrbiterChain | undefined {
  return BY_ID.get(id);
}

export function chainName(id: string): string {
  return BY_ID.get(id)?.name ?? `chain ${id}`;
}

// Resolve a graph node's chainId for the Orbiter API: prefer an explicit chainId
// (set on cross-chain nodes), else map from a known Network.
export function chainIdForNode(net?: Network, chainId?: string): string | null {
  if (chainId) return chainId;
  if (net && net !== "UNKNOWN") return ID_BY_NET.get(net) ?? null;
  return null;
}

// Identify the bridge from a node's entity tag/label so resolve can target only
// the relevant bridge (Orbiter / deBridge) instead of probing both.
export function bridgeFromLabel(label?: string | null): BridgeName | undefined {
  if (!label) return undefined;
  const l = label.toLowerCase();
  if (l.includes("orbiter")) return "orbiter";
  if (l.includes("debridge") || l.includes("dln")) return "debridge";
  if (l.includes("across")) return "across";
  if (l.includes("li.fi") || l.includes("lifi")) return "lifi";
  return undefined;
}

const bridgeFromAny = (labels: (string | null | undefined)[]): BridgeName | undefined => {
  for (const l of labels) { const b = bridgeFromLabel(l); if (b) return b; }
  return undefined;
};

// The id of the bridge node (the labelled bridge contract) this tx leads to — used
// to anchor the cross-chain arrow on the bridge instead of the tx circle. Returns
// the first bridge-labelled wallet neighbour, or undefined.
export function bridgeAnchorForTx(node: GNode, nodes: GNode[], edges: GEdge[]): string | undefined {
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.source === node.id) neighborIds.add(e.target);
    else if (e.target === node.id) neighborIds.add(e.source);
  }
  for (const n of nodes) {
    if (n.kind === "Wallet" && neighborIds.has(n.id) &&
        (n.bridge || bridgeFromAny([n.entityName, n.label]))) {
      return n.id;
    }
  }
  return undefined;
}

// Which bridge id (if any) a Tx node leads to. A cross-chain continuation only
// exists when the tx's counterparty wallet is a known bridge. Precise signal is
// `node.bridge` (set from the server-side registry); falls back to label
// keywords so Orbiter/deBridge are caught even without a registry entry.
export function bridgeForTx(node: GNode, nodes: GNode[], edges: GEdge[]): BridgeName | undefined {
  if (node.bridge) return node.bridge;
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.source === node.id) neighborIds.add(e.target);
    else if (e.target === node.id) neighborIds.add(e.source);
  }
  const neighbors = nodes.filter((n) => n.kind === "Wallet" && neighborIds.has(n.id));
  for (const n of neighbors) if (n.bridge) return n.bridge;
  // keyword fallback (registry-less detection of the well-known two)
  const self = bridgeFromAny([node.entityName, node.note, node.label]);
  if (self) return self;
  for (const n of neighbors) {
    const b = bridgeFromAny([n.entityName, n.note, n.label]);
    if (b) return b;
  }
  return undefined;
}
