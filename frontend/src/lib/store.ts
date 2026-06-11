// API client for the Node backend: auth (JWT in localStorage) + projects +
// explorer enrichment.
import type { BuiltGraph } from "./graph";

const BASE = "/api";
const TOKEN_KEY = "ct_token";

let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

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

export interface User { id: string; email: string }
export interface ProjectMeta {
  id: string; name: string; updatedAt: string;
  counts: Record<string, number>;
}
export interface Project extends ProjectMeta {
  graph: BuiltGraph;
}
export interface TxData {
  network: string; hash: string;
  from: string | null; to: string | null;
  amount?: number; asset?: string;
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

  async explorerTx(network: string, hash: string): Promise<TxData | null> {
    const r = await req<{ data: TxData | null }>(
      `/explorer/tx?network=${encodeURIComponent(network)}&hash=${encodeURIComponent(hash)}`
    );
    return r.data;
  },

  async walletTxs(
    network: string,
    address: string,
    opts: { native: boolean; token: boolean; limit: number }
  ): Promise<{ transfers: Transfer[]; diag: string | null }> {
    const q = new URLSearchParams({
      network, address,
      native: String(opts.native), token: String(opts.token), limit: String(opts.limit),
    });
    return req<{ transfers: Transfer[]; diag: string | null }>(`/explorer/wallet?${q}`);
  },
};

export interface Transfer {
  network: string; hash: string;
  from: string | null; to: string | null;
  amount?: number; asset?: string; timestamp?: number;
}
