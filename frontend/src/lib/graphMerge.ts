// Merge graphs (re-uploads, loaded projects, manual additions) by node/edge id,
// then recompute counts + linked accounts.
import {
  addWalletNet, countKinds, deriveLinked, kindColor, walletLabel,
  type BuiltGraph, type GAnnotation, type GEdge, type GNode,
} from "./graph";
import {
  addressUrl, networkColor, txUrl, walletNodeId, type Network,
} from "./explorers";
import type { OrbiterHop } from "./store";

export function emptyGraph(): BuiltGraph {
  return { nodes: [], edges: [], linked: [], warnings: [], counts: countKinds([]), annotations: [] };
}

export function finalize(
  nodes: GNode[], edges: GEdge[], warnings: string[] = [], annotations: GAnnotation[] = [],
): BuiltGraph {
  return { nodes, edges, warnings, counts: countKinds(nodes), linked: deriveLinked(nodes, edges), annotations };
}

// Drop node references that no longer exist; discard annotations left empty.
export function pruneAnnotations(annotations: GAnnotation[] | undefined, keepIds: Set<string>): GAnnotation[] {
  return (annotations ?? [])
    .map((a) => ({ ...a, nodeIds: a.nodeIds.filter((id) => keepIds.has(id)) }))
    .filter((a) => a.nodeIds.length > 0);
}

export function removeNodes(graph: BuiltGraph, ids: Set<string>): BuiltGraph {
  const nodes = graph.nodes.filter((n) => !ids.has(n.id));
  const remaining = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => remaining.has(e.source) && remaining.has(e.target));
  return finalize(nodes, edges, graph.warnings, pruneAnnotations(graph.annotations, remaining));
}

// ── Case annotations (Phase 4) ─────────────────────────────────────────────
// These edit the annotations layer without touching nodes/edges (so counts and
// linked pairs are preserved) — the caller commits the returned graph for undo.
export function annotationsForNode(graph: BuiltGraph, nodeId: string): GAnnotation[] {
  return (graph.annotations ?? []).filter((a) => a.nodeIds.includes(nodeId));
}

export function upsertAnnotation(graph: BuiltGraph, ann: GAnnotation): BuiltGraph {
  const rest = (graph.annotations ?? []).filter((a) => a.id !== ann.id);
  return { ...graph, annotations: [...rest, ann] };
}

export function deleteAnnotation(graph: BuiltGraph, id: string): BuiltGraph {
  return { ...graph, annotations: (graph.annotations ?? []).filter((a) => a.id !== id) };
}

// Per-node flags for canvas styling: which nodes carry a note / a suspect mark.
export function annotationFlags(graph: BuiltGraph): Map<string, { note: boolean; suspect: boolean }> {
  const m = new Map<string, { note: boolean; suspect: boolean }>();
  for (const a of graph.annotations ?? []) {
    for (const id of a.nodeIds) {
      const f = m.get(id) ?? { note: false, suspect: false };
      if (a.kind === "suspect") f.suspect = true; else f.note = true;
      m.set(id, f);
    }
  }
  return m;
}

// ── Transaction aggregation (collapse many tx between the same two addresses) ──
const fmtAmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const AGG_PREFIX = "AGG:";

export function hasAggregated(graph: BuiltGraph): boolean {
  return graph.nodes.some((n) => n.aggregated);
}

// Fold every group of Tx nodes that share the same (sender → recipient) wallet
// pair into a single aggregated Tx node: one circle carrying the total + period,
// with two edges (sender → agg → recipient). Groups of one are left untouched.
export function collapseTransactions(graph: BuiltGraph): BuiltGraph {
  const srcOf = new Map<string, string>(); // txId → sender wallet (SENT: wallet → tx)
  const dstOf = new Map<string, string>(); // txId → recipient wallet (TO: tx → wallet)
  for (const e of graph.edges) {
    if (e.type === "SENT") srcOf.set(e.target, e.source);
    else if (e.type === "TO") dstOf.set(e.source, e.target);
  }

  const groups = new Map<string, GNode[]>();
  for (const n of graph.nodes) {
    if (n.kind !== "Tx" || n.aggregated) continue;
    const s = srcOf.get(n.id), d = dstOf.get(n.id);
    if (!s || !d) continue; // only plain wallet→tx→wallet transfers are foldable
    const key = `${s}=>${d}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }

  const remove = new Set<string>();
  const newNodes: GNode[] = [];
  const newEdges: GEdge[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const [srcId, dstId] = key.split("=>");
    for (const m of members) remove.add(m.id);

    const coins = new Set(members.map((m) => m.coin ?? ""));
    const coin = coins.size === 1 ? [...coins][0] : "";
    const total = coin ? members.reduce((s, m) => s + (m.amount ?? 0), 0) : undefined;
    const tss = members.map((m) => m.timestamp).filter((x): x is number => x != null);
    const xs = members.map((m) => m.x).filter((x): x is number => x != null);
    const ys = members.map((m) => m.y).filter((y): y is number => y != null);
    const aggId = `${AGG_PREFIX}${srcId}=>${dstId}`;

    newNodes.push({
      id: aggId, kind: "Tx", aggregated: true,
      label: `${total != null ? `${fmtAmt(total)} ${coin}` : `${members.length} перев.`}\n▣ ${members.length}`,
      net: members[0].net, color: kindColor("Tx"), degree: 2,
      amount: total, coin: coin || undefined,
      tsFrom: tss.length ? Math.min(...tss) : undefined,
      tsTo: tss.length ? Math.max(...tss) : undefined,
      members: members.map((m) => ({
        hash: m.hash!, net: m.net, amount: m.amount, coin: m.coin,
        timestamp: m.timestamp, explorerUrl: m.explorerUrl,
        source: m.source, fetchedAt: m.fetchedAt, x: m.x, y: m.y,
      })),
      x: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined,
      y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : undefined,
    });
    newEdges.push({ id: `${srcId}->${aggId}`, source: srcId, target: aggId, type: "SENT" });
    newEdges.push({ id: `${aggId}->${dstId}`, source: aggId, target: dstId, type: "TO" });
  }

  if (!newNodes.length) return graph; // nothing to fold
  const nodes = graph.nodes.filter((n) => !remove.has(n.id)).concat(newNodes);
  const edges = graph.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)).concat(newEdges);
  return finalize(nodes, edges, graph.warnings, graph.annotations);
}

// Reverse collapseTransactions: unfold aggregated Tx nodes back into their member
// transactions (restoring their saved positions).
export function expandTransactions(graph: BuiltGraph): BuiltGraph {
  const remove = new Set<string>();
  const newNodes: GNode[] = [];
  const newEdges: GEdge[] = [];
  for (const n of graph.nodes) {
    if (!n.aggregated || !n.members) continue;
    const m = n.id.match(/^AGG:(.+)=>(.+)$/);
    if (!m) continue;
    remove.add(n.id);
    const [, srcId, dstId] = m;
    for (const mem of n.members) {
      const txId = `T:${mem.hash}`;
      newNodes.push({
        id: txId, kind: "Tx",
        label: mem.amount != null ? `${fmtAmt(mem.amount)} ${mem.coin ?? ""}` : "tx",
        net: mem.net, hash: mem.hash, amount: mem.amount, coin: mem.coin,
        color: kindColor("Tx"), degree: 1,
        explorerUrl: mem.explorerUrl, timestamp: mem.timestamp,
        source: mem.source, fetchedAt: mem.fetchedAt, x: mem.x, y: mem.y,
      });
      newEdges.push({ id: `${srcId}->${txId}`, source: srcId, target: txId, type: "SENT" });
      newEdges.push({ id: `${txId}->${dstId}`, source: txId, target: dstId, type: "TO" });
    }
  }
  if (!newNodes.length) return graph;
  const nodes = graph.nodes.filter((n) => !remove.has(n.id)).concat(newNodes);
  const edges = graph.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)).concat(newEdges);
  return finalize(nodes, edges, graph.warnings, graph.annotations);
}

// Remove nodes AND the transaction (Tx) nodes directly attached to them — i.e.
// the transactions going to/from a deleted wallet also go away, instead of being
// left as orphaned tx blobs. Other wallets on those transactions are kept.
export function removeNodesCascadeTx(graph: BuiltGraph, ids: Set<string>): BuiltGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const toRemove = new Set(ids);
  for (const e of graph.edges) {
    const s = toRemove.has(e.source), t = toRemove.has(e.target);
    if (s === t) continue; // both being removed, or neither touches the set
    const other = s ? e.target : e.source;
    if (byId.get(other)?.kind === "Tx") toRemove.add(other);
  }
  return removeNodes(graph, toRemove);
}

export function mergeGraphs(a: BuiltGraph, b: BuiltGraph): BuiltGraph {
  const nodes = new Map<string, GNode>();
  for (const n of a.nodes) nodes.set(n.id, { ...n });
  for (const n of b.nodes) {
    const ex = nodes.get(n.id);
    if (ex) {
      ex.degree += n.degree;
      if (ex.kind === "Wallet") {
        // union the chains the same address is seen on (EVM nodes span networks)
        for (const net of n.nets ?? (n.net ? [n.net] : [])) addWalletNet(ex, net);
        if (!ex.entityName && n.entityName) ex.entityName = n.entityName;
      }
    } else nodes.set(n.id, { ...n });
  }
  const edges = new Map<string, GEdge>();
  for (const e of [...a.edges, ...b.edges]) if (!edges.has(e.id)) edges.set(e.id, e);
  // Union annotations by id (later graph wins on conflict).
  const annById = new Map<string, GAnnotation>();
  for (const an of [...(a.annotations ?? []), ...(b.annotations ?? [])]) annById.set(an.id, an);
  return finalize([...nodes.values()], [...edges.values()], [...a.warnings, ...b.warnings], [...annById.values()]);
}

// Rewrite a graph to the current wallet-id scheme and merge any duplicates
// (used when loading older saved projects keyed by the per-chain id). Idempotent.
export function normalizeGraph(graph: BuiltGraph): BuiltGraph {
  const idMap = new Map<string, string>();           // old node id → canonical id
  const nodes = new Map<string, GNode>();

  for (const n of graph.nodes) {
    const newId = n.kind === "Wallet" && n.address ? walletNodeId(n.net ?? "UNKNOWN", n.address) : n.id;
    idMap.set(n.id, newId);
    const ex = nodes.get(newId);
    if (!ex) {
      nodes.set(newId, { ...n, id: newId });
    } else if (ex.kind === "Wallet") {
      ex.degree += n.degree;
      for (const net of n.nets ?? (n.net ? [n.net] : [])) addWalletNet(ex, net);
      if (!ex.entityName && n.entityName) ex.entityName = n.entityName;
      if (!ex.tag && n.tag) ex.tag = n.tag;
      if (!ex.note && n.note) ex.note = n.note;
    }
  }

  // Remap + de-duplicate edges by their endpoints (ids may have collapsed).
  const edges = new Map<string, GEdge>();
  for (const e of graph.edges) {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    if (source === target) continue; // self-loops from collapsing same-address nodes
    edges.set(`${source}|${target}|${e.type}`, { ...e, id: `${source}>${target}:${e.type}`, source, target });
  }
  // Remap annotation node refs through the same id collapse, then drop dangling ones.
  const keep = new Set(nodes.keys());
  const annotations = pruneAnnotations(
    (graph.annotations ?? []).map((a) => ({
      ...a,
      nodeIds: [...new Set(a.nodeIds.map((id) => idMap.get(id) ?? id))],
    })),
    keep,
  );
  return finalize([...nodes.values()], [...edges.values()], graph.warnings, annotations);
}

// Extract the BFS neighborhood around a focus node (default 2 hops) as a plain
// node/edge slice — the context the AI assistant analyzes. Capped so huge graphs
// don't blow the request/prompt size.
export function neighborhoodSubgraph(
  graph: BuiltGraph, focusId: string, hops = 2, maxNodes = 120,
): { nodes: GNode[]; edges: GEdge[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(focusId)) return { nodes: [], edges: [] };
  const adj = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
    (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  const keep = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let d = 0; d < hops && keep.size < maxNodes; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb) && keep.size < maxNodes) { keep.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }
  const nodes = [...keep].map((id) => byId.get(id)!).filter(Boolean);
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}

// --- manual entity merge (entity resolution) -------------------------------
// Merge several DIFFERENT nodes the analyst judges to be one actor into a single
// Entity node: every edge that touched a member now touches the entity; members
// + their original incident edges are kept on the node so the merge is reversible.
export function mergeEntities(graph: BuiltGraph, ids: string[], name?: string): BuiltGraph {
  const memberIds = new Set(ids);
  const members = graph.nodes.filter((n) => memberIds.has(n.id));
  if (members.length < 2) return graph;

  const entityId = `E:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const incident = graph.edges.filter((e) => memberIds.has(e.source) || memberIds.has(e.target));
  const nets = [...new Set(members.flatMap((m) => m.nets ?? (m.net ? [m.net] : [])))] as Network[];
  const aliasCount = members.filter((m) => m.address || m.uid).length;

  const entity: GNode = {
    id: entityId,
    kind: "Entity",
    label: name?.trim() ? name.trim() : `Сущность · ${members.length}`,
    color: kindColor("Entity"),
    degree: members.reduce((s, m) => s + m.degree, 0),
    nets: nets.length ? nets : undefined,
    entityName: name?.trim() || undefined,
    note: `${members.length} узлов${aliasCount ? `, ${aliasCount} адресов/UID` : ""}`,
    mergedFrom: members,
    mergedEdges: incident,
  };

  const remap = (id: string) => (memberIds.has(id) ? entityId : id);
  const edges = new Map<string, GEdge>();
  for (const e of graph.edges) {
    const source = remap(e.source);
    const target = remap(e.target);
    if (source === target) continue; // edges internal to the merged set
    edges.set(`${source}|${target}|${e.type}`, { ...e, id: `${source}>${target}:${e.type}`, source, target });
  }
  const nodes = graph.nodes.filter((n) => !memberIds.has(n.id)).concat(entity);
  return finalize(nodes, [...edges.values()], graph.warnings);
}

// Reverse a merge: drop the entity + its rewired edges, restore the members and
// their original incident edges.
export function unmergeEntity(graph: BuiltGraph, entityId: string): BuiltGraph {
  const entity = graph.nodes.find((n) => n.id === entityId);
  if (!entity?.mergedFrom) return graph;

  const existing = new Set(graph.nodes.filter((n) => n.id !== entityId).map((n) => n.id));
  const restoredNodes = entity.mergedFrom.filter((m) => !existing.has(m.id));
  const nodes = graph.nodes.filter((n) => n.id !== entityId).concat(restoredNodes);

  const edges = new Map<string, GEdge>();
  for (const e of graph.edges) {
    if (e.source === entityId || e.target === entityId) continue;
    edges.set(`${e.source}|${e.target}|${e.type}`, e);
  }
  for (const e of entity.mergedEdges ?? []) {
    edges.set(`${e.source}|${e.target}|${e.type}`, e);
  }
  return finalize(nodes, [...edges.values()], graph.warnings);
}

// --- manual building blocks ------------------------------------------------
export function walletNode(net: Network, address: string): GNode {
  const nets = net !== "UNKNOWN" ? [net] : [];
  return {
    id: walletNodeId(net, address),
    kind: "Wallet",
    label: walletLabel(address, nets, net),
    net, nets, address, color: networkColor(net), degree: 1,
    explorerUrl: addressUrl(net, address),
  };
}

// Convert a list of explorer transfers into a mergeable subgraph.
export function transfersSubgraph(
  transfers: { network: string; hash: string; from: string | null; to: string | null; amount?: number; asset?: string; timestamp?: number; source?: string | null; fetchedAt?: number | null }[]
): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  for (const t of transfers) {
    const sub = txSubgraph({
      net: t.network as Network, hash: t.hash,
      from: t.from, to: t.to, amount: t.amount, asset: t.asset, timestamp: t.timestamp,
      source: t.source, fetchedAt: t.fetchedAt,
    });
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
  }
  return { nodes, edges };
}

// A cross-chain tx node — supports chains outside our Network union by carrying
// an explicit explorer URL + chain name (e.g. Optimism, Linea).
function crossChainTxNode(
  hash: string, netRaw: string, chainId: string, chainName: string,
  explorerUrl: string, amount: number, symbol: string, timestamp?: number,
): GNode {
  const net = (netRaw || "UNKNOWN") as Network;
  const chainLabel = net !== "UNKNOWN" ? net : chainName;
  return {
    id: `T:${hash}`, kind: "Tx",
    label: `${amount} ${symbol}\n[${chainLabel}]`,
    net, hash, amount, coin: symbol, color: kindColor("Tx"), degree: 1,
    explorerUrl: explorerUrl || (net !== "UNKNOWN" ? txUrl(net, hash) : null),
    chainName: net === "UNKNOWN" ? chainName : undefined,
    chainId, timestamp,
  };
}

// Assemble the result of an auto-trace into a mergeable subgraph: wallet→tx→
// wallet for every discovered transfer, cross-chain bridge hops, and entity
// names applied to labelled (terminal) wallets so exchanges/contracts stand out.
export function traceSubgraph(
  transfers: Array<{ network: string; hash: string; from: string | null; to: string | null; amount?: number; asset?: string; timestamp?: number; fromLabel?: string | null; toLabel?: string | null }>,
  hops: OrbiterHop[],
): { nodes: GNode[]; edges: GEdge[] } {
  const base = transfersSubgraph(transfers);
  const nodes = [...base.nodes];
  const edges = [...base.edges];
  for (const h of hops) {
    const sub = bridgeSubgraph(h);
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
  }

  // Apply entity tags to labelled wallets (terminals of the trace).
  const labelByAddr = new Map<string, string>();
  for (const t of transfers) {
    if (t.from && t.fromLabel) labelByAddr.set(t.from.toLowerCase(), t.fromLabel);
    if (t.to && t.toLabel) labelByAddr.set(t.to.toLowerCase(), t.toLabel);
  }
  for (const n of nodes) {
    if (n.kind === "Wallet" && n.address) {
      const l = labelByAddr.get(n.address.toLowerCase());
      if (l && !n.entityName) {
        n.entityName = l;
        n.label = walletLabel(n.address, n.nets ?? (n.net && n.net !== "UNKNOWN" ? [n.net] : []), n.net, l);
      }
    }
  }
  return { nodes, edges };
}

// Build the cross-chain subgraph for an Orbiter hop: source tx → BRIDGE → target
// tx, plus sender/recipient wallet nodes when the hash lookup provided them.
export function bridgeSubgraph(hop: OrbiterHop, anchorSourceId?: string): { nodes: GNode[]; edges: GEdge[] } {
  const src = crossChainTxNode(
    hop.sourceId, hop.sourceNet, hop.sourceChain, hop.sourceChainName,
    hop.sourceTxUrl, hop.amount, hop.symbol, hop.sourceTime,
  );
  const dst = crossChainTxNode(
    hop.targetId, hop.targetNet, hop.targetChain, hop.targetChainName,
    hop.targetTxUrl, hop.amount, hop.symbol,
  );
  const nodes: GNode[] = [src, dst];
  // Anchor the cross-chain arrow on the bridge node (its contract) when known, so
  // it reads "bridge → destination" instead of "tx circle → destination".
  const bridgeFrom = anchorSourceId ?? src.id;
  const edges: GEdge[] = [
    { id: `${bridgeFrom}=>${dst.id}`, source: bridgeFrom, target: dst.id, type: "BRIDGE" },
  ];

  if (hop.sourceAddress) {
    const w = walletNode((hop.sourceNet || "UNKNOWN") as Network, hop.sourceAddress);
    nodes.push(w);
    edges.push({ id: `${w.id}->${src.id}`, source: w.id, target: src.id, type: "SENT" });
  }
  if (hop.targetWallet) {
    const w = walletNode((hop.targetNet || "UNKNOWN") as Network, hop.targetWallet);
    nodes.push(w);
    edges.push({ id: `${dst.id}->${w.id}`, source: dst.id, target: w.id, type: "TO" });
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
  timestamp?: number;
  source?: string | null;
  fetchedAt?: number | null;
}): { nodes: GNode[]; edges: GEdge[] } {
  const { net, hash, from, to, amount, asset, timestamp, source, fetchedAt } = opts;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const txId = `T:${hash}`;
  nodes.push({
    id: txId, kind: "Tx", label: amount != null ? `${amount} ${asset ?? ""}` : "tx",
    net, hash, amount, coin: asset, color: kindColor("Tx"), degree: 1,
    explorerUrl: txUrl(net, hash), timestamp, source, fetchedAt,
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
