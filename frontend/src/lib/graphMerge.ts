// Merge graphs (re-uploads, loaded projects, manual additions) by node/edge id,
// then recompute counts + linked accounts.
import {
  countKinds, deriveLinked, kindColor,
  type BuiltGraph, type GEdge, type GNode,
} from "./graph";
import {
  addrKey, addressUrl, networkColor, txUrl, type Network,
} from "./explorers";

export function emptyGraph(): BuiltGraph {
  return { nodes: [], edges: [], linked: [], warnings: [], counts: { Wallet: 0, User: 0, IP: 0, Tx: 0 } };
}

export function finalize(nodes: GNode[], edges: GEdge[], warnings: string[] = []): BuiltGraph {
  return { nodes, edges, warnings, counts: countKinds(nodes), linked: deriveLinked(nodes, edges) };
}

export function removeNodes(graph: BuiltGraph, ids: Set<string>): BuiltGraph {
  const nodes = graph.nodes.filter((n) => !ids.has(n.id));
  const remaining = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => remaining.has(e.source) && remaining.has(e.target));
  return finalize(nodes, edges, graph.warnings);
}

export function mergeGraphs(a: BuiltGraph, b: BuiltGraph): BuiltGraph {
  const nodes = new Map<string, GNode>();
  for (const n of a.nodes) nodes.set(n.id, { ...n });
  for (const n of b.nodes) {
    const ex = nodes.get(n.id);
    if (ex) ex.degree += n.degree;
    else nodes.set(n.id, { ...n });
  }
  const edges = new Map<string, GEdge>();
  for (const e of [...a.edges, ...b.edges]) if (!edges.has(e.id)) edges.set(e.id, e);
  return finalize([...nodes.values()], [...edges.values()], [...a.warnings, ...b.warnings]);
}

// --- manual building blocks ------------------------------------------------
export function walletNode(net: Network, address: string): GNode {
  return {
    id: `W:${net}:${addrKey(address)}`,
    kind: "Wallet",
    label: `${address.slice(0, 6)}…${address.slice(-4)}\n[${net}]`,
    net, address, color: networkColor(net), degree: 1,
    explorerUrl: addressUrl(net, address),
  };
}

// Convert a list of explorer transfers into a mergeable subgraph.
export function transfersSubgraph(
  transfers: { network: string; hash: string; from: string | null; to: string | null; amount?: number; asset?: string }[]
): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  for (const t of transfers) {
    const sub = txSubgraph({
      net: t.network as Network, hash: t.hash,
      from: t.from, to: t.to, amount: t.amount, asset: t.asset,
    });
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
  }
  return { nodes, edges };
}

export function txSubgraph(opts: {
  net: Network;
  hash: string;
  from?: string | null;
  to?: string | null;
  amount?: number;
  asset?: string;
}): { nodes: GNode[]; edges: GEdge[] } {
  const { net, hash, from, to, amount, asset } = opts;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const txId = `T:${hash}`;
  nodes.push({
    id: txId, kind: "Tx", label: amount != null ? `${amount} ${asset ?? ""}` : "tx",
    net, hash, amount, coin: asset, color: kindColor("Tx"), degree: 1,
    explorerUrl: txUrl(net, hash),
  });
  if (from) {
    const w = walletNode(net, from);
    nodes.push(w);
    edges.push({ id: `${w.id}->${txId}`, source: w.id, target: txId, type: "SENT" });
  }
  if (to) {
    const w = walletNode(net, to);
    nodes.push(w);
    edges.push({ id: `${txId}->${w.id}`, source: txId, target: w.id, type: "TO" });
  }
  return { nodes, edges };
}
