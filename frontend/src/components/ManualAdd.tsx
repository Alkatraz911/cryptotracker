import { useState } from "react";
import { parseExplorerUrl, type ExplorerRef } from "../lib/explorers";
import { store, type TxData, type TxTransfer } from "../lib/store";
import { txSubgraph, walletNode } from "../lib/graphMerge";
import type { GEdge, GNode } from "../lib/graph";

interface Props {
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
}

const short = (addr: string) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "?";

const fmtAmt = (n: number) =>
  n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function ManualAdd({ onAdd }: Props) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState<ExplorerRef | null>(null);
  // single-transfer editable fields
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("");
  // multi-transfer picker
  const [transfers, setTransfers] = useState<TxTransfer[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRef(null); setFrom(""); setTo(""); setAmount(""); setAsset(""); setNote(null);
    setTransfers([]); setSelected(new Set());
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === transfers.length ? new Set() : new Set(transfers.map((_, i) => i))
    );
  }

  async function recognize() {
    setErr(null); setNote(null);
    const r = parseExplorerUrl(url);
    if (!r) { setErr("Не похоже на ссылку tx/address эксплорера"); return; }
    if (r.network === "UNKNOWN") { setErr("Не удалось определить сеть по ссылке"); return; }
    setRef(r);
    if (r.kind === "tx") {
      setBusy(true);
      try {
        const { data, diag } = await store.explorerTx(r.network, r.id);
        if (data) {
          if (data.transfers && data.transfers.length > 1) {
            setTransfers(data.transfers);
            setSelected(new Set(data.transfers.map((_, i) => i)));
            setNote(`${data.transfers.length} переводов в транзакции — выберите нужные.`);
          } else {
            setFrom(data.from ?? ""); setTo(data.to ?? "");
            setAmount(data.amount != null ? String(data.amount) : "");
            setAsset(data.asset ?? "");
            setNote("Данные подтянуты из эксплорера — проверьте и поправьте при необходимости.");
          }
        } else {
          setNote(diag
            ? `Ошибка: ${diag}. Заполните поля вручную.`
            : "API не вернул данные (нет ключа/лимит). Заполните from/to/сумму вручную.");
        }
      } catch (e: any) {
        setNote("Не удалось подтянуть данные. Заполните вручную. " + (e.message ?? ""));
      } finally {
        setBusy(false);
      }
    }
  }

  function add() {
    if (!ref) return;
    if (ref.kind === "address") {
      onAdd({ nodes: [walletNode(ref.network, ref.id)], edges: [] });
      setUrl(""); reset();
      return;
    }

    const toAdd: Array<{ from: string | null; to: string | null; amount?: number; asset?: string }> =
      transfers.length > 1
        ? transfers.filter((_, i) => selected.has(i))
        : [{ from: from.trim() || null, to: to.trim() || null,
             amount: amount ? parseFloat(amount) : undefined,
             asset: asset.trim() || undefined }];

    if (!toAdd.length) { setErr("Выберите хотя бы один перевод"); return; }

    // Combine into one subgraph, deduplicating nodes/edges by id
    const nodeMap = new Map<string, GNode>();
    const edgeMap = new Map<string, GEdge>();
    for (const t of toAdd) {
      const sub = txSubgraph({ net: ref.network, hash: ref.id, from: t.from, to: t.to, amount: t.amount, asset: t.asset });
      for (const n of sub.nodes) nodeMap.set(n.id, n);
      for (const e of sub.edges) edgeMap.set(e.id, e);
    }

    onAdd({ nodes: [...nodeMap.values()], edges: [...edgeMap.values()] });
    setUrl(""); reset();
  }

  return (
    <div className="manual">
      <strong>Добавить по ссылке</strong>
      <div className="urlrow">
        <input
          placeholder="ссылка на tx или address эксплорера"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && url.trim() && recognize()}
        />
        <button onClick={recognize} disabled={busy || !url.trim()}>
          {busy ? "…" : "Распознать"}
        </button>
      </div>

      {err && <div className="error">{err}</div>}

      {ref && (
        <div className="manualform">
          <div className="reftag">
            {ref.kind === "tx" ? "Транзакция" : "Кошелёк"} · {ref.network}
          </div>

          {ref.kind === "tx" ? (
            transfers.length > 1 ? (
              <div className="transfer-picker">
                <div className="picker-header">
                  <span>{transfers.length} переводов</span>
                  <button className="link" onClick={toggleAll}>
                    {selected.size === transfers.length ? "Снять все" : "Выбрать все"}
                  </button>
                </div>
                {transfers.map((t, i) => (
                  <label key={i} className={`trow${selected.has(i) ? " sel" : ""}`}>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    <span className="taddr">{short(t.from)}</span>
                    <span className="tarrow">→</span>
                    <span className="taddr">{short(t.to)}</span>
                    <span className="tamt">{fmtAmt(t.amount)} {t.asset}</span>
                  </label>
                ))}
              </div>
            ) : (
              <>
                <input placeholder="from address" value={from} onChange={(e) => setFrom(e.target.value)} />
                <input placeholder="to address" value={to} onChange={(e) => setTo(e.target.value)} />
                <div className="row2">
                  <input placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <input placeholder="asset" value={asset} onChange={(e) => setAsset(e.target.value)} />
                </div>
              </>
            )
          ) : (
            <div className="reftag mono">{ref.id}</div>
          )}

          {note && <div className="muted">{note}</div>}
          <button
            className="primary"
            onClick={add}
            disabled={transfers.length > 1 && selected.size === 0}
          >
            {transfers.length > 1
              ? `Добавить выбранные (${selected.size})`
              : "Добавить в граф"}
          </button>
        </div>
      )}
    </div>
  );
}
