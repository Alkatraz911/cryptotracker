// Turn parsed exchange-export rows into a deduplicated graph.
// Correct merging is the whole point: the SAME address / UID / IP across rows
// must collapse to ONE node, so shared IPs and shared deposit wallets surface
// links between different exchange accounts.
import {
  addrKey, addressUrl, hashFromUrl, networkColor, networkFromAddress,
  networkFromUrl, normalizeNetwork, txUrl, type Network,
} from "./explorers";
import type { Mapping } from "./csv";

export type Kind = "Wallet" | "User" | "IP" | "Tx";

export interface GNode {
  id: string;
  kind: Kind;
  label: string;
  net?: Network;
  address?: string;
  uid?: string;
  exchange?: string;
  ip?: string;
  hash?: string;
  coin?: string;
  amount?: number;
  explorerUrl?: string | null;
  color: string;
  degree: number;
  entityName?: string; // label pulled from explorer (contract name / token name / name tag)
  tag?: string; // manual marker category id (see lib/tags.ts)
  note?: string; // free-text marker / annotation
}

export type EdgeType =
  | "WITHDREW"
  | "TO"
  | "USED_IP"
  | "FROM_IP"
  | "WITHDREW_TO"
  | "SENT"; // on-chain transfer (manual / explorer add)

export interface GEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export interface LinkedPair {
  a: string; // user node id
  b: string;
  aLabel: string;
  bLabel: string;
  sharedIps: string[];
  sharedWallets: string[];
  weight: number;
}

export interface BuiltGraph {
  nodes: GNode[];
  edges: GEdge[];
  linked: LinkedPair[];
  warnings: string[];
  counts: Record<Kind, number>;
}

const KIND_COLOR: Record<Kind, string> = {
  User: "#a855f7",
  Wallet: "#3b82f6", // overridden per-network below
  IP: "#f59e0b",
  Tx: "#6b7280",
};

export function kindColor(kind: Kind): string {
  return KIND_COLOR[kind];
}

function val(row: Record<string, string>, col: string | null): string {
  if (!col) return "";
  return (row[col] ?? "").trim();
}

export function buildGraph(
  rows: Record<string, string>[],
  m: Mapping
): BuiltGraph {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const warnings: string[] = [];

  // resource -> set of user ids (for clustering)
  const ipUsers = new Map<string, Set<string>>();
  const walletUsers = new Map<string, Set<string>>();

  const upsert = (n: GNode) => {
    const existing = nodes.get(n.id);
    if (existing) {
      existing.degree++;
      // fill in any missing detail
      if (!existing.amount && n.amount) existing.amount = n.amount;
      if (!existing.coin && n.coin) existing.coin = n.coin;
      return existing;
    }
    nodes.set(n.id, n);
    return n;
  };
  const link = (e: GEdge) => {
    if (!edges.has(e.id)) edges.set(e.id, e);
  };

  let badNet = 0;
  rows.forEach((row, i) => {
    const uid = val(row, m.uid);
    const exchange = val(row, m.exchange) || "exchange";
    const address = val(row, m.address);
    const ip = val(row, m.ip);
    const coin = val(row, m.coin);
    const amount = parseFloat(val(row, m.amount)) || undefined;
    const url = val(row, m.txurl);
    let hash = val(row, m.txid);

    // network resolution: explicit col -> tx url -> address shape
    let net = normalizeNetwork(val(row, m.network));
    if (net === "UNKNOWN" && url) net = networkFromUrl(url);
    if (net === "UNKNOWN" && address) net = networkFromAddress(address);
    if (net === "UNKNOWN" && (address || url)) badNet++;

    if (!hash && url) hash = hashFromUrl(url) ?? "";

    // --- nodes ---
    let userId = "";
    if (uid) {
      userId = `U:${exchange}|${uid}`;
      upsert({
        id: userId, kind: "User", label: `UID ${uid}\n${exchange}`,
        uid, exchange, color: KIND_COLOR.User, degree: 1,
      });
    }

    let walletId = "";
    if (address) {
      walletId = `W:${net}:${addrKey(address)}`;
      upsert({
        id: walletId, kind: "Wallet",
        label: `${address.slice(0, 6)}…${address.slice(-4)}\n[${net}]`,
        net, address, color: networkColor(net), degree: 1,
        explorerUrl: addressUrl(net, address),
      });
    }

    let txId = "";
    if (hash) {
      txId = `T:${hash}`;
      upsert({
        id: txId, kind: "Tx",
        label: amount ? `${amount} ${coin}` : "tx",
        net, hash, coin, amount, color: KIND_COLOR.Tx, degree: 1,
        explorerUrl: txUrl(net, hash) ?? (url || null),
      });
    }

    let ipId = "";
    if (ip) {
      ipId = `I:${ip}`;
      upsert({ id: ipId, kind: "IP", label: ip, ip, color: KIND_COLOR.IP, degree: 1 });
    }

    // --- edges ---
    if (userId && txId) link({ id: `${userId}->${txId}`, source: userId, target: txId, type: "WITHDREW" });
    if (txId && walletId) link({ id: `${txId}->${walletId}`, source: txId, target: walletId, type: "TO" });
    if (userId && walletId && !txId)
      link({ id: `${userId}~>${walletId}`, source: userId, target: walletId, type: "WITHDREW_TO" });
    if (userId && ipId) link({ id: `${userId}=>${ipId}`, source: userId, target: ipId, type: "USED_IP" });
    if (txId && ipId) link({ id: `${txId}=>${ipId}`, source: txId, target: ipId, type: "FROM_IP" });

    // --- clustering bookkeeping ---
    if (userId && ipId) (ipUsers.get(ipId) ?? ipUsers.set(ipId, new Set()).get(ipId)!).add(userId);
    if (userId && walletId)
      (walletUsers.get(walletId) ?? walletUsers.set(walletId, new Set()).get(walletId)!).add(userId);

    if (!uid && !address && !hash) warnings.push(`Row ${i + 2}: no uid/address/tx — skipped`);
  });

  if (badNet)
    warnings.push(
      `${badNet} row(s) had an unknown network (no network column, link, or recognizable address).`
    );

  const linked = clusterUsers(ipUsers, walletUsers, nodes);
  const counts: Record<Kind, number> = { Wallet: 0, User: 0, IP: 0, Tx: 0 };
  for (const n of nodes.values()) counts[n.kind]++;

  return { nodes: [...nodes.values()], edges: [...edges.values()], linked, warnings, counts };
}

export function countKinds(nodes: GNode[]): Record<Kind, number> {
  const c: Record<Kind, number> = { Wallet: 0, User: 0, IP: 0, Tx: 0 };
  for (const n of nodes) c[n.kind]++;
  return c;
}

// Recompute linked-account pairs from nodes+edges (used after load/merge,
// when the clustering bookkeeping from buildGraph is not around).
export function deriveLinked(nodes: GNode[], edges: GEdge[]): LinkedPair[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const ipUsers = new Map<string, Set<string>>();
  const walletUsers = new Map<string, Set<string>>();
  const txOwner = new Map<string, string>(); // tx -> user
  const txWallet = new Map<string, string>(); // tx -> wallet
  const add = (m: Map<string, Set<string>>, k: string, v: string) =>
    (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);

  for (const e of edges) {
    if (e.type === "USED_IP") add(ipUsers, e.target, e.source);
    else if (e.type === "WITHDREW") txOwner.set(e.target, e.source);
    else if (e.type === "WITHDREW_TO") add(walletUsers, e.target, e.source);
    else if (e.type === "TO") txWallet.set(e.source, e.target);
  }
  for (const [tx, user] of txOwner) {
    const w = txWallet.get(tx);
    if (w) add(walletUsers, w, user);
  }
  return clusterUsers(ipUsers, walletUsers, nodeMap);
}

function clusterUsers(
  ipUsers: Map<string, Set<string>>,
  walletUsers: Map<string, Set<string>>,
  nodes: Map<string, GNode>
): LinkedPair[] {
  const pairs = new Map<string, LinkedPair>();
  const label = (id: string) =>
    nodes.get(id)?.label.replace("\n", " · ") ?? id;

  const addPair = (a: string, b: string, kind: "ip" | "wallet", resource: string) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    let p = pairs.get(key);
    if (!p) {
      p = { a: x, b: y, aLabel: label(x), bLabel: label(y), sharedIps: [], sharedWallets: [], weight: 0 };
      pairs.set(key, p);
    }
    const res = resource.replace(/^[IW]:/, "");
    if (kind === "ip" && !p.sharedIps.includes(res)) { p.sharedIps.push(res); p.weight += 40; }
    if (kind === "wallet" && !p.sharedWallets.includes(res)) { p.sharedWallets.push(res); p.weight += 90; }
  };

  for (const [ipId, users] of ipUsers) {
    const arr = [...users];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) addPair(arr[i], arr[j], "ip", ipId);
  }
  for (const [wId, users] of walletUsers) {
    const arr = [...users];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) addPair(arr[i], arr[j], "wallet", wId);
  }

  return [...pairs.values()].sort((a, b) => b.weight - a.weight);
}
