import "dotenv/config"; // MUST be first: populate process.env before other modules
import Fastify from "fastify";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import { createStorage } from "./storage/index.js";
import { fetchTx, fetchWalletTransfers, fetchAddressLabel } from "./explorer.js";

const storage = await createStorage();
console.log(`[explorer] ETHERSCAN_API_KEY: ${process.env.ETHERSCAN_API_KEY ? "set" : "MISSING — EVM wallet history will be empty"}`);
console.log(`[explorer] SOLSCAN_API_KEY:   ${process.env.SOLSCAN_API_KEY ? "set" : "MISSING — Solana token transfers will use public API (limited)"}`);
const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
if (SECRET === "dev-secret-change-me")
  console.warn("[warn] JWT_SECRET is the default dev value — set it in .env for real use.");

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

// --- auth helpers ----------------------------------------------------------
function sign(user) {
  return jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: "30d" });
}

app.decorate("auth", async function (req, reply) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return reply.code(401).send({ error: "no token" });
  try {
    req.user = jwt.verify(token, SECRET);
  } catch {
    return reply.code(401).send({ error: "invalid token" });
  }
  // Token may be valid but reference a user from a different/reset store
  // (e.g. switched lowdb → Postgres). Force a clean re-login instead of a
  // 500 foreign-key error on write.
  if (!(await storage.getUserById(req.user.uid)))
    return reply.code(401).send({ error: "account not found — please register/log in again" });
});

const publicUser = (u) => ({ id: u.id, email: u.email });
const counts = (graph) => {
  const c = { Wallet: 0, User: 0, IP: 0, Tx: 0 };
  for (const n of graph?.nodes ?? []) if (c[n.kind] != null) c[n.kind]++;
  return c;
};

// --- auth routes -----------------------------------------------------------
app.post("/auth/register", async (req, reply) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6)
    return reply.code(400).send({ error: "email and password (min 6 chars) required" });
  const norm = String(email).trim().toLowerCase();
  if (await storage.getUserByEmail(norm))
    return reply.code(409).send({ error: "email already registered" });
  const user = await storage.createUser({
    id: randomUUID(),
    email: norm,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  });
  return { token: sign(user), user: publicUser(user) };
});

app.post("/auth/login", async (req, reply) => {
  const { email, password } = req.body || {};
  const norm = String(email || "").trim().toLowerCase();
  const user = await storage.getUserByEmail(norm);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash))
    return reply.code(401).send({ error: "invalid credentials" });
  return { token: sign(user), user: publicUser(user) };
});

app.get("/me", { preHandler: app.auth }, async (req) => ({ user: { id: req.user.uid, email: req.user.email } }));

// --- projects --------------------------------------------------------------
app.get("/projects", { preHandler: app.auth }, async (req) => {
  const list = await storage.listProjects(req.user.uid);
  return list
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, counts: counts(p.graph) }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
});

app.post("/projects", { preHandler: app.auth }, async (req, reply) => {
  const { name, graph } = req.body || {};
  if (!name) return reply.code(400).send({ error: "name required" });
  const now = new Date().toISOString();
  const project = await storage.createProject({
    id: randomUUID(),
    userId: req.user.uid,
    name: String(name),
    graph: graph || { nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
  });
  return { id: project.id, name: project.name, updatedAt: project.updatedAt };
});

async function owned(req, reply) {
  const p = await storage.getProject(req.params.id);
  if (!p || p.userId !== req.user.uid) {
    reply.code(404).send({ error: "not found" });
    return null;
  }
  return p;
}

app.get("/projects/:id", { preHandler: app.auth }, async (req, reply) => {
  const p = await owned(req, reply);
  return p ? p : undefined;
});

app.put("/projects/:id", { preHandler: app.auth }, async (req, reply) => {
  const p = await owned(req, reply);
  if (!p) return;
  const { name, graph } = req.body || {};
  const updated = await storage.updateProject(p.id, {
    name: name != null ? String(name) : undefined,
    graph: graph != null ? graph : undefined,
    updatedAt: new Date().toISOString(),
  });
  return { id: updated.id, name: updated.name, updatedAt: updated.updatedAt };
});

app.delete("/projects/:id", { preHandler: app.auth }, async (req, reply) => {
  const p = await owned(req, reply);
  if (!p) return;
  await storage.deleteProject(p.id);
  return { ok: true };
});

// --- explorer enrichment ---------------------------------------------------
app.get("/explorer/tx", { preHandler: app.auth }, async (req) => {
  const { network, hash } = req.query || {};
  if (!network || !hash) return { data: null, diag: null };
  try {
    const data = await fetchTx(String(network).toUpperCase(), String(hash));
    return { data, diag: data ? null : `${network}: RPC вернул пустой ответ (tx не найдена или RPC недоступен)` };
  } catch (e) {
    return { data: null, diag: String(e?.message || e) };
  }
});

app.get("/explorer/label", { preHandler: app.auth }, async (req) => {
  const { network, address } = req.query || {};
  if (!network || !address) return { label: null };
  return fetchAddressLabel(String(network).toUpperCase(), String(address));
});

app.get("/explorer/wallet", { preHandler: app.auth }, async (req) => {
  const { network, address, native, token, limit } = req.query || {};
  if (!network || !address) return { transfers: [] };
  const { transfers, diag } = await fetchWalletTransfers(String(network).toUpperCase(), String(address), {
    native: native !== "false",
    token: token !== "false",
    limit: limit ? Number(limit) : 50,
  });
  return { transfers, diag };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`CryptoTracker server on http://localhost:${PORT}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
