import { useEffect, useMemo, useRef, useState } from "react";
import Auth from "./components/Auth";
import DataLoader from "./components/DataLoader";
import GraphView from "./components/GraphView";
import ManualAdd from "./components/ManualAdd";
import NodeModal from "./components/NodeModal";
import PromptModal from "./components/PromptModal";
import ConfirmModal from "./components/ConfirmModal";
import Modal from "./components/Modal";
import { store, type ProjectMeta, type User } from "./lib/store";
import { emptyGraph, finalize, mergeGraphs, removeNodes } from "./lib/graphMerge";
import type { BuiltGraph, GNode } from "./lib/graph";
import { addressUrl, networkColor, type Network } from "./lib/explorers";

type PromptCfg = {
  title: string; label?: string; defaultValue?: string; confirmText?: string;
  onSubmit: (v: string) => void;
};
type ConfirmCfg = {
  title?: string; message: string; confirmText?: string; danger?: boolean;
  onConfirm: () => void;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [graph, setGraph] = useState<BuiltGraph>(emptyGraph());
  const [prevGraph, setPrevGraph] = useState<BuiltGraph | null>(null);
  const [dirty, setDirty] = useState(false);

  const [modalNode, setModalNode] = useState<GNode | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptCfg | null>(null);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [unsaved, setUnsaved] = useState<{ proceed: () => void } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);

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
      store.addressLabel(n.net!, n.address!).then(({ label }) => {
        if (label) labelNode(n.id, label);
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, user]);

  const DRAFT_KEY = "ct_draft";

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
        graph: finalize(d.graph.nodes, d.graph.edges ?? [], d.graph.warnings ?? []),
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

  async function loadProjects() { setProjects(await store.listProjects()); }

  function applyGraph(g: BuiltGraph) { setPrevGraph(graph); setGraph(g); setDirty(true); }

  function undoLastImport() {
    if (!prevGraph) return;
    setGraph(prevGraph);
    setPrevGraph(null);
    setDirty(true);
  }

  function newProject() {
    fetchingIds.current = new Set();
    setCurrentId(null); setName(""); setGraph(emptyGraph());
    setPrevGraph(null); setModalNode(null); setFocusId(null); setDirty(false);
  }

  async function openProject(id: string) {
    fetchingIds.current = new Set();
    const p = await store.getProject(id);
    setCurrentId(p.id); setName(p.name);
    setGraph(finalize(p.graph.nodes ?? [], p.graph.edges ?? [], p.graph.warnings ?? []));
    setPrevGraph(null); setModalNode(null); setFocusId(null); setDirty(false);
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

  function labelNode(id: string, entityName: string) {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== id || !n.address) return n;
        const short = `${n.address.slice(0, 6)}…${n.address.slice(-4)}`;
        const name = entityName.length > 30 ? entityName.slice(0, 28) + "…" : entityName;
        return { ...n, entityName, label: `${name}\n${short} [${n.net}]` };
      }),
    }));
    setModalNode((mn) => (mn?.id === id ? { ...mn, entityName } : mn));
    setDirty(true);
  }

  function removeNode(id: string) {
    setGraph((g) => removeNodes(g, new Set([id])));
    setModalNode(null);
    setDirty(true);
  }

  function setNetNode(id: string, net: Network) {
    const update = (n: GNode): GNode => {
      if (n.id !== id || !n.address) return n;
      const short = `${n.address.slice(0, 6)}…${n.address.slice(-4)}`;
      const label = n.entityName
        ? `${n.entityName.length > 30 ? n.entityName.slice(0, 28) + "…" : n.entityName}\n${short} [${net}]`
        : `${short}\n[${net}]`;
      return { ...n, net, color: networkColor(net), explorerUrl: addressUrl(net, n.address), label };
    };
    setGraph((g) => ({ ...g, nodes: g.nodes.map(update) }));
    setModalNode((mn) => (mn?.id === id ? update(mn) : mn));
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

  // apply a manual marker to a node
  function markNode(id: string, patch: { tag?: string; note?: string }) {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    setModalNode((mn) => (mn && mn.id === id ? { ...mn, ...patch } : mn));
    setDirty(true);
  }

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

  function focus(id: string) {
    setFocusId(id);
    setModalNode(graph.nodes.find((n) => n.id === id) ?? null);
  }

  function logout() {
    localStorage.removeItem(DRAFT_KEY);
    store.logout(); setUser(null); newProject(); setProjects([]);
  }

  if (!ready) return <div className="boot">Загрузка…</div>;
  if (!user) return <Auth onAuthed={afterAuth} />;

  const has = graph.nodes.length > 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="userbar">
          <span className="email">{user.email}</span>
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
        <ManualAdd onAdd={(sub) => applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)))} />

        {prevGraph && (
          <button onClick={undoLastImport} style={{ marginTop: 6 }}>
            ↩ Отменить последнюю загрузку
          </button>
        )}

        {has && (
          <>
            <div className="stats">
              {(["Wallet", "User", "Tx", "IP"] as const).map((k) => (
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

        <div className="hint">Клик по узлу — диалог · двойной клик — открыть в эксплорере</div>
      </aside>

      <main className="canvas">
        {has && (
          <button className="relayout-btn" onClick={() => setLayoutKey((k) => k + 1)} title="Перераспределить узлы">↺</button>
        )}
        {!has ? (
          <div className="empty">Загрузите CSV/XLSX или добавьте кошелёк/транзакцию по ссылке</div>
        ) : (
          <GraphView
            graph={graph}
            onSelect={(n) => setModalNode(n)}
            focusId={focusId}
            onPositionsSave={savePositions}
            layoutKey={layoutKey}
          />
        )}
      </main>

      {modalNode && (
        <NodeModal node={modalNode} onClose={() => setModalNode(null)}
          onAdd={(sub) => applyGraph(mergeGraphs(graph, finalize(sub.nodes, sub.edges)))}
          onMark={markNode}
          onRemove={removeNode}
          onLabel={labelNode}
          onSetNet={setNetNode} />
      )}
      {importOpen && (
        <Modal title="Импорт CSV / XLSX" onClose={() => setImportOpen(false)} width={560}>
          <DataLoader onBuild={(g) => { applyGraph(mergeGraphs(graph, g)); setImportOpen(false); }} />
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
