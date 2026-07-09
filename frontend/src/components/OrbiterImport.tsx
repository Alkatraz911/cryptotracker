import { useState } from "react";
import { store, type OrbiterHop } from "../lib/store";
import { bridgeSubgraph } from "../lib/graphMerge";
import { ORBITER_CHAINS } from "../lib/orbiter";
import type { GEdge, GNode } from "../lib/graph";

interface Props {
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
  onClose: () => void;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function OrbiterImport({ onAdd, onClose }: Props) {
  const [bridge, setBridge] = useState<"orbiter" | "debridge">("orbiter");
  const [source, setSource] = useState("42161");
  const [target, setTarget] = useState("");        // "" = все
  const [minUsd, setMinUsd] = useState(100);
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [hops, setHops] = useState<OrbiterHop[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setBusy(true); setMsg(null); setHops(null);
    try {
      const since = from ? new Date(from + "T00:00:00Z").getTime() : undefined;
      const until = to ? new Date(to + "T23:59:59Z").getTime() : undefined;
      const { hops, diag } = bridge === "debridge"
        ? await store.debridgeFeed({ source, target: target || undefined, minUsd, since, limit })
        : await store.orbiterFeed({ source, target: target || undefined, minUsd, since, until, limit });
      if (!hops.length) { setMsg(diag ?? "Переводов не найдено."); return; }
      setHops(hops);
    } catch (e: any) {
      setMsg(e.message ?? "Ошибка запроса к мосту");
    } finally {
      setBusy(false);
    }
  }

  function addAll() {
    if (!hops?.length) return;
    const nodes = new Map<string, GNode>();
    const edges = new Map<string, GEdge>();
    for (const h of hops) {
      const sub = bridgeSubgraph(h);
      for (const n of sub.nodes) nodes.set(n.id, n);
      for (const e of sub.edges) edges.set(e.id, e);
    }
    onAdd({ nodes: [...nodes.values()], edges: [...edges.values()] });
    onClose();
  }

  const totalUsd = hops?.reduce((s, h) => s + (h.usd || 0), 0) ?? 0;

  return (
    <div className="orbiter-import">
      <p className="muted">
        Кроссчейн-переводы через мост за выбранный период. Orbiter: прыжок по времени достаёт и старую историю.
        deBridge (DLN): хранит всю историю, тянется от свежих к старым с адресами отправителя/получателя.
      </p>

      <div className="ltrow">
        <label>Мост</label>
        <select value={bridge} onChange={(e) => setBridge(e.target.value as "orbiter" | "debridge")}>
          <option value="orbiter">Orbiter</option>
          <option value="debridge">deBridge (DLN)</option>
        </select>
      </div>
      <div className="ltrow">
        <label>Из сети</label>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {ORBITER_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="ltrow">
        <label>В сеть</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— все —</option>
          {ORBITER_CHAINS.filter((c) => c.id !== source).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="ltrow">
        <label>Период</label>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">—</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="ltchecks">
        <label className="lim">мин $ <input type="number" min={0} value={minUsd}
          onChange={(e) => setMinUsd(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="lim">лимит <input type="number" min={1} max={500} value={limit}
          onChange={(e) => setLimit(Math.min(500, Math.max(1, Number(e.target.value) || 1)))} /></label>
      </div>

      {msg && <div className="flash">{msg}</div>}

      <button className="primary" onClick={load} disabled={busy}>
        {busy ? "Загрузка…" : "Загрузить переводы"}
      </button>

      {hops && hops.length > 0 && (
        <>
          <div className="flash">
            Найдено {hops.length} переводов · сумма ≈ ${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <ul className="orbiter-preview">
            {hops.slice(0, 12).map((h, i) => (
              <li key={i}>
                <span className="oc">{h.sourceChainName} → {h.targetChainName}</span>
                <span className="oa">{h.amount} {h.symbol}</span>
                <span className="ou">${h.usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </li>
            ))}
            {hops.length > 12 && <li className="muted">…ещё {hops.length - 12}</li>}
          </ul>
          <button className="primary" onClick={addAll}>Добавить {hops.length} в граф</button>
        </>
      )}
    </div>
  );
}
