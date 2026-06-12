import { useState } from "react";
import { parseExplorerUrl, type ExplorerRef } from "../lib/explorers";
import { store, type TxTransfer } from "../lib/store";
import { txSubgraph, walletNode } from "../lib/graphMerge";
import TransferPreviewModal from "./TransferPreviewModal";
import type { GEdge, GNode } from "../lib/graph";

interface Props {
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
}

export default function ManualAdd({ onAdd }: Props) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState<ExplorerRef | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("");
  const [transfers, setTransfers] = useState<TxTransfer[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRef(null); setFrom(""); setTo(""); setAmount(""); setAsset(""); setNote(null);
    setTransfers([]); setShowPicker(false);
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
            setNote(`${data.transfers.length} переводов в транзакции`);
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

  function addSingle() {
    if (!ref) return;
    if (ref.kind === "address") {
      onAdd({ nodes: [walletNode(ref.network, ref.id)], edges: [] });
    } else {
      onAdd(txSubgraph({
        net: ref.network, hash: ref.id,
        from: from.trim() || null, to: to.trim() || null,
        amount: amount ? parseFloat(amount) : undefined,
        asset: asset.trim() || undefined,
      }));
    }
    setUrl(""); reset();
  }

  function addFromPicker(sel: TxTransfer[]) {
    if (!ref || !sel.length) return;
    const nodeMap = new Map<string, GNode>();
    const edgeMap = new Map<string, GEdge>();
    for (const t of sel) {
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
          <div className="reftag">{ref.kind === "tx" ? "Транзакция" : "Кошелёк"} · {ref.network}</div>

          {ref.kind === "tx" && transfers.length <= 1 && (
            <>
              <input placeholder="from address" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input placeholder="to address" value={to} onChange={(e) => setTo(e.target.value)} />
              <div className="row2">
                <input placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input placeholder="asset" value={asset} onChange={(e) => setAsset(e.target.value)} />
              </div>
            </>
          )}

          {ref.kind === "address" && <div className="reftag mono">{ref.id}</div>}

          {note && <div className="muted">{note}</div>}

          {transfers.length > 1 ? (
            <button className="primary" onClick={() => setShowPicker(true)}>
              Предпросмотр переводов ({transfers.length}) →
            </button>
          ) : (
            <button className="primary" onClick={addSingle}>Добавить в граф</button>
          )}
        </div>
      )}

      {showPicker && ref && (
        <TransferPreviewModal
          transfers={transfers}
          onAdd={addFromPicker}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
