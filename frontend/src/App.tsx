import { useEffect, useMemo, useRef, useState } from "react";
import Auth from "./components/Auth";
import DataLoader from "./components/DataLoader";
import GraphView from "./components/GraphView";
import ManualAdd from "./components/ManualAdd";
import OrbiterImport from "./components/OrbiterImport";
import SidePanel from "./components/SidePanel";
import AdminPage from "./components/AdminPage";
import PromptModal from "./components/PromptModal";
import ConfirmModal from "./components/ConfirmModal";
import Modal from "./components/Modal";
import Toolbar from "./components/Toolbar";
import { store, type AiMsg, type NodeNetCache, type ProjectMeta, type User } from "./lib/store";
import { deleteAnnotation, emptyGraph, finalize, mergeEntities, mergeGraphs, normalizeGraph, removeNodesCascadeTx, traceSubgraph, unmergeEntity, upsertAnnotation } from "./lib/graphMerge";
import { walletLabel, type BuiltGraph, type GAnnotation, type GEdge, type GNode } from "./lib/graph";
import { addressUrl, networkColor, type Network } from "./lib/explorers";
import { applyTheme, getStoredTheme, type Theme } from "./lib/theme";

type PromptCfg = {
  title: string; label?: string; defaultValue?: string; confirmText?: string;
  onSubmit: (v: string) => void;
};
type ConfirmCfg = {
  title?: string; message: string; confirmText?: string; danger?: boolean;
  onConfirm: () => void;
};

// Cached explorer data: nodeId → network → { transfers, diag, balance }.
type TxCacheMap = Record<string, Record<string, NodeNetCache>>;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [graph, setGraph] = useState<BuiltGraph>(emptyGraph());
  const [dirty, setDirty] = useState(false);

  // Undo/redo stacks of graph snapshots (structural mutations only).
  const [past, setPast] = useState<BuiltGraph[]>([]);
  const [future, setFuture] = useState<BuiltGraph[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Per-node AI conversations, keyed by node id, persisted to localStorage so
  // the user can return to any node's chat at any time.
  const [chats, setChats] = useState<Record<string, AiMsg[]>>({});
  // Cached explorer data per node → network (transfers + balance), persisted so
  // the side panel never re-fetches a node it has already loaded. Kept until the
  // node is removed or the user logs out.
  const [txCache, setTxCache] = useState<TxCacheMap>({});
  const [prompt, setPrompt] = useState<PromptCfg | null>(null);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [unsaved, setUnsaved] = useState<{ proceed: () => void } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [orbiterOpen, setOrbiterOpen] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [structureKey, setStructureKey] = useState(0);
  // Canvas multi-select mode: pick several nodes for a bulk action (merge into
  // an entity, or mass delete). null = normal (tap opens the node panel).
  const [selectMode, setSelectMode] = useState<"merge" | "delete" | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false); // left panel collapsed by default
  const [adminOpen, setAdminOpen] = useState(false);

  const selectedNode = useMemo(
    () => (selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, graph.nodes]
  );

  // Track which wallet IDs we've already initiated label fetches for so we
  // never double-fetch within a session, even when graph state re-renders.
  const fetchingIds = useRef(new Set<string>());

  const nodeKey = useMemo(
    () => graph.nodes.map((n) => n.id).sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.nodes.length, graph.nodes.map((n) => n.id).join("|")]
  );

  // Auto-fetch entity labels for newly added wallet nodes.
  useEffect(() => {
    if (!user) return;
    const candidates = graph.nodes.filter(
      (n) =>
        n.kind === "Wallet" &&
        n.address &&
        n.net &&
        n.net !== "UNKNOWN" &&
        !n.entityName &&
        !fetchingIds.current.has(n.id)
    );
    if (!candidates.length) return;
    for (const n of candidates) {
      fetchingIds.current.add(n.id);
      store.addressLabel(n.net!, n.address!).then(({ label, bridge }) => {
        if (label) labelNode(n.id, label, bridge);
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, user]);

  const DRAFT_KEY = "ct_draft";
  const CHATS_KEY = "ct_chats";

  // Load persisted per-node chats once, and persist them on every change.
  useEffect(() => {
    try { const raw = localStorage.getItem(CHATS_KEY); if (raw) setChats(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch { /* quota — skip */ }
  }, [chats]);

  function setNodeChat(id: string, msgs: AiMsg[]) {
    setChats((c) => ({ ...c, [id]: msgs }));
  }

  // Merge cached explorer data for one node+network (called by the side panel
  // after it fetches transfers/balance).
  function cacheNet(nodeId: string, net: string, patch: NodeNetCache) {
    setTxCache((c) => ({ ...c, [nodeId]: { ...c[nodeId], [net]: { ...c[nodeId]?.[net], ...patch } } }));
  }

  // On a 401 mid-session, drop to the login screen but keep the working graph
  // in memory (and the localStorage draft) so nothing is lost on re-login.
  useEffect(() => {
    store.setOnUnauthorized(() => { setUser(null); flash("Войдите снова, чтобы сохранить"); });
  }, []);

  // tracks whether a graph is currently in memory (for in-session re-login)
  const hasGraph = useRef(false);
  useEffect(() => { hasGraph.current = graph.nodes.length > 0; }, [graph]);

  useEffect(() => {
    if (!store.isAuthed()) { setReady(true); return; }
    // Capture the draft NOW, before setUser triggers the save-effect that
    // would overwrite localStorage with the (still empty) initial graph.
    const draft = parseDraft(localStorage.getItem(DRAFT_KEY));
    store.me()
      .then(async (u) => { setUser(u); await loadProjects(); applyDraft(draft); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  type Draft = { graph: BuiltGraph; currentId: string | null; name: string };

  function parseDraft(raw: string | null): Draft | null {
    try {
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d.graph?.nodes?.length) return null;
      return {
        graph: normalizeGraph(finalize(d.graph.nodes, d.graph.edges ?? [], d.graph.warnings ?? [], d.graph.annotations ?? [])),
        currentId: d.currentId ?? null,
        name: d.name ?? "",
      };
    } catch { return null; }
  }

  function applyDraft(d: Draft | null) {
    if (!d) return;
    setGraph(d.graph);
    setCurrentId(d.currentId);
    setName(d.name);
    setDirty(!d.currentId);
  }

  // Called after login/registration (initial and after a mid-session 401).
  function afterAuth(u: User) {
    const draft = parseDraft(localStorage.getItem(DRAFT_KEY));
    setUser(u);
    // login/register don't carry the effective role — refresh it from /me.
    store.me().then(setUser).catch(() => {});
    loadProjects();
    if (!hasGraph.current) applyDraft(draft); // keep in-memory work on re-login
  }

  // Persist a draft of the working graph on every change.
  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ currentId, name, graph }));
    } catch { /* quota exceeded on very large graphs — skip */ }
  }, [user, currentId, name, graph]);

  // Autosave an OPEN project to the DB shortly after changes.
  useEffect(() => {
    if (!currentId || !dirty) return;
    const t = setTimeout(() => {
      store.updateProject(currentId, { name, graph })
        .then(() => { setDirty(false); return loadProjects(); })
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [graph, name, currentId, dirty]);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, past, future]);

  async function loadProjects() { setProjects(await store.listProjects()); }

  // ── history-aware mutations ────────────────────────────────────────────────
  function commit(next: BuiltGraph) {
    setPast((p) => [...p, graph].slice(-50));
    setFuture([]);
    setGraph(next);
    setDirty(true);
  }
  function applyGraph(g: BuiltGraph) { commit(g); }

  function undo() {
    if (!past.length) return;
    setFuture((f) => [graph, ...f]);
    setGraph(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, graph]);
    setGraph(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  }
  function resetHistory() { setPast([]); setFuture([]); }

  function newProject() {
    fetchingIds.current = new Set();
    setCurrentId(null); setName(""); setGraph(emptyGraph());
    setTxCache({});
    resetHistory(); setSelectedId(null); setFocusId(null); setDirty(false);
  }

  async function openProject(id: string) {
    fetchingIds.current = new Set();
    const p = await store.getProject(id);
    setCurrentId(p.id); setName(p.name);
    setGraph(normalizeGraph(finalize(p.graph.nodes ?? [], p.graph.edges ?? [], p.graph.warnings ?? [], p.graph.annotations ?? [])));
    setTxCache({}); // session cache; transfers come from the shared store on demand
    resetHistory(); setSelectedId(null); setFocusId(null); setDirty(false);
  }

  function saveProject() {
    if (currentId) {
      store.updateProject(currentId, { name, graph })
        .then(() => { setDirty(false); return loadProjects(); })
        .then(() => flash("Сохранено")).catch((e) => flash(e.message));
      return;
    }
    setPrompt({
      title: "Сохранить расследование", label: "Название",
      defaultValue: name || "Новое дело", confirmText: "Сохранить",
      onSubmit: (nm) => {
        store.createProject(nm, graph)
          .then((meta) => { setCurrentId(meta.id); setName(meta.name); setDirty(false); return loadProjects(); })
          .then(() => flash("Сохранено")).catch((e) => flash(e.message));
      },
    });
  }

  function rename() {
    setPrompt({
      title: "Переименовать", label: "Название", defaultValue: name, confirmText: "Сохранить",
      onSubmit: (nm) => {
        setName(nm);
        if (currentId) store.updateProject(currentId, { name: nm }).then(loadProjects);
      },
    });
  }

  function deleteProject() {
    if (!currentId) return;
    setConfirm({
      title: "Удалить дело", message: `Удалить «${name}»? Действие необратимо.`,
      confirmText: "Удалить", danger: true,
      onConfirm: () => {
        store.deleteProject(currentId).then(() => { newProject(); return loadProjects(); });
      },
    });
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(null), 2500); }

  // Toolbar editable title.
  function editTitle(nm: string) { setName(nm); setDirty(true); }

  // Label/network/position changes are enrichment/layout — not undoable, applied
  // with a functional update so async auto-label callbacks never go stale.
  function labelNode(id: string, entityName: string, bridge?: string) {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== id || !n.address) return n;
        const nets = n.nets ?? (n.net && n.net !== "UNKNOWN" ? [n.net] : []);
        return { ...n, entityName, bridge: bridge ?? n.bridge, label: walletLabel(n.address, nets, n.net, entityName) };
      }),
    }));
    setDirty(true);
  }

  function setNetNode(id: string, net: Network) {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== id || !n.address) return n;
        const nets = [...new Set([...(n.nets ?? []), ...(net !== "UNKNOWN" ? [net] : [])])];
        return {
          ...n, net, nets, color: networkColor(net),
          explorerUrl: addressUrl(net, n.address),
          label: walletLabel(n.address, nets, net, n.entityName),
        };
      }),
    }));
    setDirty(true);
  }

  // Generic non-undoable node patch (e.g. backfilling a Tx timestamp on demand).
  function patchNode(id: string, patch: Partial<GNode>) {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    setDirty(true);
  }

  function savePositions(pos: Record<string, { x: number; y: number }>) {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        const p = pos[n.id];
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    }));
    setDirty(true);
  }

  // Delete node(s) plus the transactions attached to them (undoable), and drop
  // the session caches/chats of everything that was removed. Closes the panel if
  // its node is gone.
  function applyDelete(ids: string[]) {
    const next = removeNodesCascadeTx(graph, new Set(ids));
    const keep = new Set(next.nodes.map((n) => n.id));
    const gone = graph.nodes.filter((n) => !keep.has(n.id)).map((n) => n.id);
    commit(next);
    setTxCache((c) => { const m = { ...c }; for (const g of gone) delete m[g]; return m; });
    setChats((c) => { const m = { ...c }; for (const g of gone) delete m[g]; return m; });
    if (selectedId && !keep.has(selectedId)) setSelectedId(null);
  }

  function removeNode(id: string) { applyDelete([id]); }

  // Case notes (Phase 4): add/edit or remove an investigator note tied to
  // a node (persisted in the graph → autosaved, undoable).
  function saveAnnotation(ann: GAnnotation) { commit(upsertAnnotation(graph, ann)); }
  function removeAnnotation(id: string) { commit(deleteAnnotation(graph, id)); }

  // Run a navigation (new/open) but offer to save first if there are unsaved changes.
  function requestNav(fn: () => void) {
    if (dirty && graph.nodes.length > 0) setUnsaved({ proceed: fn });
    else fn();
  }

  function saveThen(proceed: () => void) {
    setUnsaved(null);
    if (currentId) {
      store.updateProject(currentId, { name, graph })
        .then(() => { setDirty(false); return loadProjects(); })
        .then(() => proceed())
        .catch((e) => flash(e.message));
    } else {
      setPrompt({
        title: "Сохранить расследование", label: "Название",
        defaultValue: name || "Новое дело", confirmText: "Сохранить",
        onSubmit: (nm) => {
          store.createProject(nm, graph)
            .then(() => loadProjects())
            .then(() => proceed())
            .catch((e) => flash(e.message));
        },
      });
    }
  }

  function handleManualAdd(sub: { nodes: GNode[]; edges: GEdge[] }) {
    const isSoloWallet =
      sub.nodes.length === 1 && sub.edges.length === 0 && sub.nodes[0].kind === "Wallet";
    if (isSoloWallet && graph.nodes.some((n) => n.id === sub.nodes[0].id)) {
      flash("Адрес уже добавлен на холст");
      return;
    }
    applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)));
  }

  function exitSelect() { setSelectMode(null); setSelection([]); }
  function toggleSelectMode(mode: "merge" | "delete") {
    setSelection([]);
    if (selectMode === mode) { setSelectMode(null); return; }
    if (selectMode !== null) {
      // Switching modes: drop to null first so the canvas clears its highlights,
      // then enter the new mode on the next tick.
      setSelectMode(null);
      setTimeout(() => setSelectMode(mode), 0);
    } else {
      setSelectMode(mode);
    }
  }

  function confirmMerge() {
    const ids = selection;
    if (ids.length < 2) { flash("Выберите минимум 2 узла"); return; }
    setPrompt({
      title: "Объединить в сущность",
      label: "Название (необязательно)",
      confirmText: "Объединить",
      onSubmit: (name) => { applyGraph(mergeEntities(graph, ids, name)); exitSelect(); store.logUsage("Слияние сущностей"); },
    });
  }

  function confirmDelete() {
    const ids = selection;
    if (!ids.length) { flash("Выберите узлы для удаления"); return; }
    setConfirm({
      title: "Удалить узлы",
      message: `Удалить выбранные узлы (${ids.length}) и все их связи? Можно отменить (Ctrl+Z).`,
      confirmText: `Удалить (${ids.length})`, danger: true,
      onConfirm: () => {
        applyDelete(ids);
        exitSelect();
        store.logUsage("Массовое удаление узлов");
      },
    });
  }

  function unmergeNode(id: string) {
    applyGraph(unmergeEntity(graph, id));
    setSelectedId(null);
  }

  async function traceFlow(
    node: GNode,
    opts: { network: Network; direction: "out" | "in"; hops: number; minUsd: number },
  ): Promise<string> {
    if (!node.address) return "У узла нет адреса для трассировки.";
    const { transfers, hops, terminals, stats, diag } = await store.traceFlow({
      network: opts.network, address: node.address,
      direction: opts.direction, hops: opts.hops, minUsd: opts.minUsd,
    });
    if (!transfers.length) return diag ?? "Поток не прослежен.";
    const sub = traceSubgraph(transfers, hops);
    applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)));
    setStructureKey((k) => k + 1); // auto hierarchical layout to reveal the flow
    return `Прослежено: узлов ${stats.nodes ?? "?"}, переводов ${transfers.length}` +
      `${hops.length ? `, мостов ${hops.length}` : ""}${terminals.length ? `, остановок (биржи/контракты) ${terminals.length}` : ""}.`;
  }

  // Focus a node on the canvas and open its panel (from lists / search / contacts).
  function focus(id: string) {
    if (!graph.nodes.some((n) => n.id === id)) { flash("Узел не найден на графе"); return; }
    setFocusId(id);
    setSelectedId(id);
  }

  function toggleTheme() {
    const t: Theme = theme === "dark" ? "light" : "dark";
    setTheme(t); applyTheme(t);
  }

  function logout() {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(CHATS_KEY);
    setChats({}); setTxCache({});
    store.logout(); setUser(null); newProject(); setProjects([]);
  }

  if (!ready) return <div className="boot">Загрузка…</div>;
  if (!user) return <Auth onAuthed={afterAuth} />;
  if (adminOpen && user.role === "admin") return <AdminPage user={user} onClose={() => setAdminOpen(false)} />;

  const has = graph.nodes.length > 0;

  return (
    <div className="app">
      {sidebarOpen && (
      <aside className="sidebar">
        <div className="userbar">
          <span className="email">{user.email}</span>
          {user.role === "admin" && <button className="link" onClick={() => setAdminOpen(true)}>⚙ Админ</button>}
          <button className="link" onClick={logout}>Выйти</button>
        </div>

        <div className="projbar">
          <select value={currentId ?? ""}
            onChange={(e) => { const v = e.target.value; requestNav(() => (v ? openProject(v) : newProject())); }}>
            <option value="">— новое дело —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="projbtns">
            <button onClick={() => requestNav(newProject)}>Новое</button>
            <button className="primary" onClick={saveProject}>Сохранить{dirty ? " •" : ""}</button>
            <button onClick={rename} disabled={!has && !currentId}>Переим.</button>
            <button onClick={deleteProject} disabled={!currentId}>Удалить</button>
          </div>
          {name && <div className="curname">{name}{dirty && <i> · не сохранено</i>}</div>}
        </div>

        {msg && <div className="flash">{msg}</div>}

        <button className="filebtn" style={{ marginTop: 10 }} onClick={() => setImportOpen(true)}>
          ↑ Импорт CSV / XLSX
        </button>
        <button className="filebtn" style={{ marginTop: 6 }} onClick={() => setOrbiterOpen(true)}>
          ⇄ Кроссчейн (мосты)
        </button>
        <ManualAdd onAdd={handleManualAdd} />

        {has && (
          <>
            <div className="stats">
              {(["Wallet", "User", "Tx", "IP", "Entity"] as const).map((k) => (
                <div key={k} className="stat">
                  <span className="num">{graph.counts[k]}</span>
                  <span className="lbl">{k}</span>
                </div>
              ))}
            </div>

            {graph.warnings.length > 0 && (
              <details className="warn">
                <summary>{graph.warnings.length} warning(s)</summary>
                <ul>{graph.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul>
              </details>
            )}

            {graph.linked.length > 0 && (
              <div className="linked">
                <strong>Связанные аккаунты ({graph.linked.length})</strong>
                <ul>
                  {graph.linked.slice(0, 25).map((l, i) => (
                    <li key={i}>
                      <button className="linkrow" onClick={() => focus(l.a)}>{l.aLabel}</button>
                      <span className="wt">w{l.weight}</span>
                      <button className="linkrow" onClick={() => focus(l.b)}>{l.bLabel}</button>
                      <div className="signals">
                        {l.sharedIps.length > 0 && <span>IP×{l.sharedIps.length}</span>}
                        {l.sharedWallets.length > 0 && <span>wallet×{l.sharedWallets.length}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="hint">Клик по узлу — панель справа · двойной клик — открыть в эксплорере</div>
      </aside>
      )}

      <main className="workspace">
        <Toolbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          name={name}
          dirty={dirty}
          onEditTitle={editTitle}
          nodes={graph.nodes}
          onFocusNode={focus}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          onUndo={undo}
          onRedo={redo}
          hasGraph={has}
          onForceLayout={() => setLayoutKey((k) => k + 1)}
          onStructure={() => setStructureKey((k) => k + 1)}
          mergeMode={selectMode === "merge"}
          onToggleMerge={() => toggleSelectMode("merge")}
          deleteMode={selectMode === "delete"}
          onToggleDelete={() => toggleSelectMode("delete")}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="canvas">
          {selectMode === "merge" && (
            <div className="mergebar">
              <span>Кликайте узлы для объединения · выбрано: {selection.length}</span>
              <button className="primary" disabled={selection.length < 2} onClick={confirmMerge}>Объединить</button>
              <button onClick={exitSelect}>Отмена</button>
            </div>
          )}
          {selectMode === "delete" && (
            <div className="mergebar deletebar">
              <span>Кликайте узлы для удаления · выбрано: {selection.length}</span>
              <button className="danger" disabled={!selection.length} onClick={confirmDelete}>Удалить ({selection.length})</button>
              <button onClick={exitSelect}>Отмена</button>
            </div>
          )}
          {!has ? (
            <div className="empty">Откройте панель ☰ слева, чтобы импортировать CSV/XLSX или добавить кошелёк по ссылке</div>
          ) : (
            <GraphView
              graph={graph}
              onSelect={(n) => setSelectedId(n?.id ?? null)}
              selectedId={selectedId}
              focusId={focusId}
              onPositionsSave={savePositions}
              layoutKey={layoutKey}
              structureKey={structureKey}
              mergeMode={selectMode !== null}
              onMergeSelection={setSelection}
              theme={theme}
            />
          )}
        </div>
      </main>

      {selectedNode && (
        <SidePanel
          node={selectedNode}
          graph={graph}
          onClose={() => setSelectedId(null)}
          onAdd={(sub) => applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)))}
          onRemove={removeNode}
          onSaveAnnotation={saveAnnotation}
          onDeleteAnnotation={removeAnnotation}
          onLabel={labelNode}
          onSetNet={setNetNode}
          onUnmerge={unmergeNode}
          onTrace={traceFlow}
          onFocus={focus}
          onPatchNode={patchNode}
          cache={txCache[selectedNode.id] ?? {}}
          onCacheNet={(net, patch) => cacheNet(selectedNode.id, net, patch)}
          chat={chats[selectedNode.id] ?? []}
          onChatChange={(msgs) => setNodeChat(selectedNode.id, msgs)}
        />
      )}

      {importOpen && (
        <Modal title="Импорт CSV / XLSX" onClose={() => setImportOpen(false)} width={560}>
          <DataLoader onBuild={(g) => { applyGraph(mergeGraphs(graph, g)); setImportOpen(false); store.logUsage("Импорт CSV"); }} />
        </Modal>
      )}
      {orbiterOpen && (
        <Modal title="Кроссчейн-переводы (мосты)" onClose={() => setOrbiterOpen(false)} width={460}>
          <OrbiterImport
            onAdd={(sub) => applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)))}
            onClose={() => setOrbiterOpen(false)}
          />
        </Modal>
      )}
      {unsaved && (
        <Modal title="Несохранённые изменения" onClose={() => setUnsaved(null)}>
          <p className="confirmmsg">Текущее дело не сохранено. Сохранить перед переключением?</p>
          <div className="modalactions">
            <button onClick={() => { const go = unsaved.proceed; setUnsaved(null); go(); }}>
              Не сохранять
            </button>
            <button className="primary" onClick={() => saveThen(unsaved.proceed)}>Сохранить</button>
          </div>
          <button className="link" onClick={() => setUnsaved(null)}>Отмена</button>
        </Modal>
      )}
      {prompt && (
        <PromptModal {...prompt}
          onSubmit={(v) => { prompt.onSubmit(v); setPrompt(null); }}
          onClose={() => setPrompt(null)} />
      )}
      {confirm && (
        <ConfirmModal {...confirm}
          onConfirm={confirm.onConfirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
