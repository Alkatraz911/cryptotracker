import { useEffect, useRef, useState } from "react";
import { store, type AiModel, type AiModelCatalog } from "../lib/store";

const MODEL_KEY = "ct_ai_model";

export function loadSavedModel(): string {
  try { return localStorage.getItem(MODEL_KEY) ?? ""; } catch { return ""; }
}
function saveModel(id: string) {
  try { if (id) localStorage.setItem(MODEL_KEY, id); else localStorage.removeItem(MODEL_KEY); } catch { /* ignore */ }
}

// The catalogue is the same for every node chat — fetch it once per session
// and let every picker share (and refresh) it.
let catalogCache: AiModelCatalog | null = null;
let catalogPromise: Promise<AiModelCatalog> | null = null;
async function getCatalog(force = false): Promise<AiModelCatalog> {
  if (!force && catalogCache) return catalogCache;
  if (!force && catalogPromise) return catalogPromise;
  catalogPromise = store.aiModels().then((c) => { catalogCache = c; return c; }).finally(() => { catalogPromise = null; });
  return catalogPromise;
}
// Let a chat that just learned a model is dead update the shared cache.
export function markModel(id: string, patch: Partial<AiModel>) {
  if (!catalogCache) return;
  catalogCache = { ...catalogCache, models: catalogCache.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

const STATUS_ICON: Record<AiModel["status"], string> = { ok: "✓", fail: "✗", unknown: "?" };
const GROUPS: { status: AiModel["status"]; title: string }[] = [
  { status: "ok", title: "Работают" },
  { status: "unknown", title: "Не проверены" },
  { status: "fail", title: "Не отвечают" },
];

interface Props {
  value: string;               // "" = server default (AI_MODEL)
  onChange: (id: string) => void;
  refreshKey?: number;         // bump to force a catalogue reload
}

export default function AiModelPicker({ value, onChange, refreshKey = 0 }: Props) {
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(catalogCache);
  const [err, setErr] = useState<string | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    let alive = true;
    setErr(null);
    getCatalog(refreshKey > 0).then((c) => { if (alive) setCatalog(c); }).catch((e) => { if (alive) setErr(e.message ?? "Список моделей недоступен"); });
    return () => { alive = false; };
  }, [refreshKey]);

  // A saved choice that has since died, or no choice at all → steer to the
  // best known-working model so the first question doesn't hit a 404.
  useEffect(() => {
    if (!catalog) return;
    const cur = catalog.models.find((m) => m.id === (value || catalog.current));
    if (cur && cur.status !== "fail") return;
    const best = catalog.models.find((m) => m.status === "ok");
    if (best && best.id !== value) { onChange(best.id); saveModel(best.id); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  function apply(m: AiModel, r: { ok: boolean; status: AiModel["status"]; latencyMs: number | null; error: string | null }) {
    const patch = { status: r.status, latencyMs: r.latencyMs, error: r.error, checkedAt: new Date().toISOString() };
    markModel(m.id, patch);
    setCatalog((c) => c && { ...c, models: c.models.map((x) => (x.id === m.id ? { ...x, ...patch } : x)) });
  }

  async function probeOne(id: string) {
    const m = catalog?.models.find((x) => x.id === id);
    if (!m) return;
    setProbing(id); setErr(null);
    try { apply(m, await store.aiProbeModel(id)); }
    catch (e: any) { setErr(e.message ?? "Ошибка проверки"); }
    finally { setProbing(null); }
  }

  // Sequential on purpose: free-tier gateways rate-limit bursts, and each
  // probe is its own request so a serverless backend never runs long.
  async function probeAll() {
    if (!catalog) return;
    const todo = catalog.models.filter((m) => m.status !== "ok");
    cancel.current = false;
    setBulk({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (cancel.current) break;
      try { apply(todo[i], await store.aiProbeModel(todo[i].id)); } catch { /* keep going */ }
      setBulk({ done: i + 1, total: todo.length });
    }
    setBulk(null);
  }

  function select(id: string) {
    onChange(id); saveModel(id);
    const m = catalog?.models.find((x) => x.id === id);
    if (m && m.status !== "ok") void probeOne(id);
  }

  const selected = value || catalog?.current || "";
  const sel = catalog?.models.find((m) => m.id === selected);
  const busy = !!probing || !!bulk;

  return (
    <div className="ai-model">
      <label className="ai-model-row">
        <span className="dk">модель</span>
        <select value={selected} onChange={(e) => select(e.target.value)} disabled={!catalog || busy} title={sel?.error ?? sel?.id}>
          {!catalog && <option value="">загрузка…</option>}
          {catalog && GROUPS.map((g) => {
            const items = catalog.models.filter((m) => m.status === g.status);
            return items.length ? (
              <optgroup key={g.status} label={g.title}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {STATUS_ICON[m.status]} {m.name}{m.free && catalog.allowPaid ? " (бесплатная)" : ""}{m.latencyMs != null && m.status === "ok" ? ` — ${(m.latencyMs / 1000).toFixed(1)} с` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        <button type="button" className="link" disabled={!selected || busy} onClick={() => probeOne(selected)} title="Проверить выбранную модель">
          {probing === selected ? "…" : "⟳"}
        </button>
      </label>
      <div className="ai-model-foot muted">
        {bulk
          ? <>проверка {bulk.done}/{bulk.total}… <button type="button" className="link" onClick={() => { cancel.current = true; }}>стоп</button></>
          : <>
              {sel?.status === "fail" && <span className="ai-model-bad">не отвечает{sel.error ? `: ${sel.error}` : ""}. </span>}
              {catalog && <button type="button" className="link" onClick={probeAll} disabled={busy}>проверить все</button>}
              {catalog && <button type="button" className="link" onClick={() => getCatalog(true).then(setCatalog).catch((e) => setErr(e.message))} disabled={busy}>обновить список</button>}
              {err && <span className="ai-model-bad">{err}</span>}
            </>}
      </div>
    </div>
  );
}
