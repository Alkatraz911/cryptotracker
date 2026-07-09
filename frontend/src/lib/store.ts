// API client for the Node backend: auth (JWT in localStorage) + projects +
// explorer enrichment.
import type { BuiltGraph } from "./graph";

const BASE = "/api";
const TOKEN_KEY = "ct_token";

let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;
let resolversCache: Promise<{ id: string; name: string }[]> | null = null;

function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (init.body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new Error("Сессия истекла — войдите снова");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface User { id: string; email: string; role?: "user" | "admin" }
export interface BridgeAddress { address: string; bridge: string; name: string; createdAt?: string }
export interface AdminUser { id: string; email: string; role: string; createdAt: string }

export interface ModuleStat { module: string; count: number; users: number }
export interface AdminUserStat {
  userId: string; email: string; role: string;
  events: number; lastActive: string | null;
  modules: { module: string; count: number }[];
}
export interface Analytics {
  days: number; since: string; totalEvents: number; activeUsers: number;
  byModule: ModuleStat[]; byUser: AdminUserStat[];
}
export interface ProjectMeta {
  id: string; name: string; updatedAt: string;
  counts: Record<string, number>;
}
export interface Project extends ProjectMeta {
  graph: BuiltGraph;
}
export interface TxTransfer {
  from: string; to: string; amount: number; asset: string;
}

export interface TxData {
  network: string; hash: string;
  from: string | null; to: string | null;
  amount?: number; asset?: string; timestamp?: number;
  transfers?: TxTransfer[];
}

export const store = {
  isAuthed: () => !!token,

  // Registered by the app to drop to the login screen when a request 401s
  // mid-session (e.g. token references a user missing from the current DB).
  setOnUnauthorized(cb: () => void) { onUnauthorized = cb; },

  async register(email: string, password: string): Promise<User> {
    const r = await req<{ token: string; user: User }>("/auth/register", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    setToken(r.token);
    return r.user;
  },
  async login(email: string, password: string): Promise<User> {
    const r = await req<{ token: string; user: User }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    setToken(r.token);
    return r.user;
  },
  async me(): Promise<User> {
    return (await req<{ user: User }>("/me")).user;
  },
  logout() { setToken(null); },

  listProjects: () => req<ProjectMeta[]>("/projects"),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  createProject: (name: string, graph: BuiltGraph) =>
    req<ProjectMeta>("/projects", { method: "POST", body: JSON.stringify({ name, graph }) }),
  updateProject: (id: string, patch: { name?: string; graph?: BuiltGraph }) =>
    req<ProjectMeta>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteProject: (id: string) =>
    req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  async explorerTx(network: string, hash: string): Promise<{ data: TxData | null; diag: string | null }> {
    return req<{ data: TxData | null; diag: string | null }>(
      `/explorer/tx?network=${encodeURIComponent(network)}&hash=${encodeURIComponent(hash)}`
    );
  },

  async addressLabel(network: string, address: string): Promise<{ label: string | null; bridge?: string }> {
    return req<{ label: string | null; bridge?: string }>(
      `/explorer/label?network=${encodeURIComponent(network)}&address=${encodeURIComponent(address)}`
    );
  },

  // Bridges that support cross-chain resolution (drives the resolve button).
  // Memoized — the set rarely changes within a session.
  bridgeResolvers(): Promise<{ id: string; name: string }[]> {
    return (resolversCache ??= req<{ id: string; name: string }[]>("/explorer/bridges/resolvers"));
  },

  // Wallet transfers from the shared chain-data store (fetched from the explorer
  // once, then reused). `force` re-fetches; `from`/`to` (ms) slice the stored
  // history by date range server-side.
  async walletTxs(
    network: string,
    address: string,
    opts: { native: boolean; token: boolean; limit: number; force?: boolean; from?: number; to?: number }
  ): Promise<{ transfers: Transfer[]; diag: string | null; status?: SourceStatus }> {
    const q = new URLSearchParams({
      network, address,
      native: String(opts.native), token: String(opts.token), limit: String(opts.limit),
    });
    if (opts.force) q.set("force", "true");
    if (opts.from != null) q.set("from", String(opts.from));
    if (opts.to != null) q.set("to", String(opts.to));
    return req<{ transfers: Transfer[]; diag: string | null; status?: SourceStatus }>(`/chaindata/wallet?${q}`);
  },

  // Health of the scraping/API data sources (for a status badge / admin view).
  sourceHealth: () => req<SourceHealthReport>("/explorer/health"),

  // ── Admin: bridge registry ──────────────────────────────────────────────
  listBridges: () => req<BridgeAddress[]>("/explorer/bridges"),
  addBridge: (b: { address: string; bridge: string; name: string }) =>
    req<BridgeAddress>("/explorer/bridges", { method: "POST", body: JSON.stringify(b) }),
  removeBridge: (address: string) =>
    req<{ ok: boolean }>(`/explorer/bridges/${encodeURIComponent(address)}`, { method: "DELETE" }),

  // ── Admin: users ─────────────────────────────────────────────────────────
  listUsers: () => req<AdminUser[]>("/admin/users"),
  createUser: (u: { email: string; password: string; role?: "user" | "admin" }) =>
    req<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id: string, patch: { email?: string; password?: string; role?: "user" | "admin" }) =>
    req<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: string) =>
    req<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),

  // ── Admin: analytics ─────────────────────────────────────────────────────
  getAnalytics: (days = 30) => req<Analytics>(`/admin/analytics?days=${days}`),

  // Beacon for client-only modules — fire-and-forget.
  logUsage: (module: string) =>
    req<{ ok: boolean }>("/usage", { method: "POST", body: JSON.stringify({ module }) }).catch(() => {}),

  // Native on-chain balance for a wallet (the network's gas token), priced in USD.
  async walletBalance(network: string, address: string): Promise<WalletBalance> {
    return req<WalletBalance>(
      `/explorer/balance?network=${encodeURIComponent(network)}&address=${encodeURIComponent(address)}`
    );
  },

  // Auto-trace value flow from a wallet ("follow the money").
  async traceFlow(opts: {
    network: string; address: string;
    direction?: "out" | "in"; hops?: number; minUsd?: number; perNode?: number;
  }): Promise<{ transfers: Transfer[]; hops: OrbiterHop[]; terminals: string[]; stats: Record<string, number>; diag: string | null }> {
    const q = new URLSearchParams({ network: opts.network, address: opts.address });
    if (opts.direction) q.set("direction", opts.direction);
    if (opts.hops != null) q.set("hops", String(opts.hops));
    if (opts.minUsd != null) q.set("minUsd", String(opts.minUsd));
    if (opts.perNode != null) q.set("perNode", String(opts.perNode));
    return req(`/explorer/trace?${q}`);
  },

  // Resolve a tx hash to its Orbiter cross-chain counterpart.
  // chainId is optional — the direct lookup works by hash alone; it only helps
  // the older-history feed fallback.
  async orbiterResolve(
    hash: string, chainId?: string | null, ts?: number, bridge?: string
  ): Promise<{ hop: OrbiterHop | null; diag: string | null }> {
    const q = new URLSearchParams({ hash });
    if (chainId) q.set("chainId", chainId);
    if (ts) q.set("ts", String(ts));
    if (bridge) q.set("bridge", bridge);
    return req<{ hop: OrbiterHop | null; diag: string | null }>(`/explorer/orbiter/resolve?${q}`);
  },

  // Import a window of deBridge (DLN) cross-chain orders.
  async debridgeFeed(opts: {
    source?: string; target?: string; minUsd?: number; since?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    const q = new URLSearchParams();
    if (opts.source) q.set("source", opts.source);
    if (opts.target) q.set("target", opts.target);
    if (opts.minUsd != null) q.set("minUsd", String(opts.minUsd));
    if (opts.since != null) q.set("since", String(opts.since));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    return req<{ hops: OrbiterHop[]; diag: string | null }>(`/explorer/debridge/feed?${q}`);
  },

  // ── AI assistant (pluggable local/Claude + RAG) ──────────────────────────
  // Which engine is active and whether it's configured.
  async aiHealth(): Promise<AiHealth> {
    return req<AiHealth>("/ai/health");
  },

  // Analyze a subgraph: narrative + risk signals (RAG knowledge + heuristics).
  async aiAnalyze(payload: {
    focusId?: string;
    nodes: AiNodeLite[];
    edges: { source: string; target: string; type?: string }[];
    question?: string;
  }): Promise<AiAnalysis> {
    return req<AiAnalysis>("/ai/analyze", { method: "POST", body: JSON.stringify(payload) });
  },

  // Feed the learning loop: 👍/👎 + optional correction become RAG guidance.
  async aiFeedback(body: {
    rating: "up" | "down"; correction?: string; focusAddress?: string; focusNetwork?: string;
  }): Promise<{ ok: boolean; stored: boolean }> {
    return req("/ai/feedback", { method: "POST", body: JSON.stringify(body) });
  },

  // Teach the assistant a labelled address (becomes retrievable next time).
  async aiAddKnowledge(body: {
    kind: "address" | "pattern"; network?: string; address?: string; title: string; content: string;
  }): Promise<{ ok: boolean }> {
    return req("/ai/knowledge", { method: "POST", body: JSON.stringify(body) });
  },

  // Import a chain-pair feed of Orbiter bridge transfers within a time window.
  async orbiterFeed(opts: {
    source: string; target?: string; minUsd?: number; since?: number; until?: number; limit?: number;
  }): Promise<{ hops: OrbiterHop[]; diag: string | null }> {
    const q = new URLSearchParams({ source: opts.source });
    if (opts.target) q.set("target", opts.target);
    if (opts.minUsd != null) q.set("minUsd", String(opts.minUsd));
    if (opts.since != null) q.set("since", String(opts.since));
    if (opts.until != null) q.set("until", String(opts.until));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    return req<{ hops: OrbiterHop[]; diag: string | null }>(`/explorer/orbiter/feed?${q}`);
  },
};

// One Orbiter cross-chain bridge hop (source tx ↔ target tx).
export interface OrbiterHop {
  sourceId: string; targetId: string;
  sourceChain: string; targetChain: string;
  sourceChainName: string; targetChainName: string;
  sourceNet: string; targetNet: string;
  sourceTxUrl: string; targetTxUrl: string;
  amount: number; symbol: string; usd: number;
  sourceTime: number;
  sourceAddress?: string; // sender wallet on source chain (from hash lookup)
  targetWallet?: string;  // recipient wallet on target chain (from hash lookup)
}

// ── AI assistant shapes ──────────────────────────────────────────────────────
export interface AiHealth {
  provider: string; model: string; configured: boolean; knowledge: number;
}
export interface RiskSignal { id: string; label: string; severity: "info" | "warn" | "high" }
export interface AiAnalysis {
  narrative: string;
  signals: RiskSignal[];
  used: { provider: string; model: string; knowledge: number; nodes: number; edges: number } | null;
  diag: string | null;
}
// Trimmed node shape posted for analysis (mirrors lib/graph GNode).
export interface AiNodeLite {
  id: string; kind: string; label?: string;
  address?: string | null; net?: string | null; nets?: string[] | null;
  entityName?: string | null; tag?: string | null; note?: string | null;
  amount?: number | null; coin?: string | null; chainName?: string | null;
}

export interface Transfer {
  network: string; hash: string;
  from: string | null; to: string | null;
  amount?: number; asset?: string; timestamp?: number;
  usdValue?: number;
  fromLabel?: string | null;
  toLabel?: string | null;
  source?: string | null;    // provenance: data source this fact came from
  fetchedAt?: number | null;  // provenance: when it was pulled into the store (ms)
}

export interface WalletHolding { asset: string; amount: number; usdValue: number | null; }
export interface WalletBalance {
  holdings: WalletHolding[]; totalUsd: number | null; diag: string | null;
}

// Health of a data source (explorer/scraper). `down` = unreachable; `drift` =
// reachable but our parser broke on changed markup (needs a code fix).
export type SourceStatus = "ok" | "empty" | "down" | "drift";
export interface SourceHealth {
  source: string;
  status: SourceStatus | "unknown";
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastDriftAt: number | null;
  consecutiveFailures: number;
  totalOk: number;
  totalFail: number;
  totalDrift: number;
  lastNote: string | null;
  lastLatencyMs: number | null;
}
export interface SourceHealthReport {
  generatedAt: number; ok: boolean; degraded: string[]; sources: SourceHealth[];
}

// One message in a per-node AI chat (persisted so the user can return to it).
export interface AiMsg { role: "user" | "assistant"; text: string; signals?: RiskSignal[]; }

// In-memory (session) cache of explorer data for one wallet node on one network,
// so the side panel doesn't re-request on every open within a session. The
// durable store lives server-side (chaindata: wallets + transactions). Keyed in
// the app as cache[nodeId][network].
export interface NodeNetCache {
  transfers?: Transfer[];
  diag?: string | null;
  status?: SourceStatus;
  bal?: WalletBalance;
}
