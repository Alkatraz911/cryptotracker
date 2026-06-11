import { useState } from "react";
import { parseExplorerUrl, type ExplorerRef } from "../lib/explorers";
import { store } from "../lib/store";
import { txSubgraph, walletNode } from "../lib/graphMerge";
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
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRef(null); setFrom(""); setTo(""); setAmount(""); setAsset(""); setNote(null);
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
        const data = await store.explorerTx(r.network, r.id);
        if (data) {
          setFrom(data.from ?? ""); setTo(data.to ?? "");
          setAmount(data.amount != null ? String(data.amount) : "");
          setAsset(data.asset ?? "");
          setNote("Данные подтянуты из эксплорера — проверьте и поправьте при необходимости.");
        } else {
          setNote("API не вернул данные (нет ключа/лимит). Заполните from/to/сумму вручную.");
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
    } else {
      onAdd(
        txSubgraph({
          net: ref.network, hash: ref.id,
          from: from.trim() || null, to: to.trim() || null,
          amount: amount ? parseFloat(amount) : undefined,
          asset: asset.trim() || undefined,
        })
      );
    }
    setUrl(""); reset();
  }

  return (
    <div className="manual">
      <strong>Добавить по ссылке</strong>
      <div className="urlrow">
        <input placeholder="ссылка на tx или address эксплорера"
          value={url} onChange={(e) => setUrl(e.target.value)} />
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
            <>
              <input placeholder="from address" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input placeholder="to address" value={to} onChange={(e) => setTo(e.target.value)} />
              <div className="row2">
                <input placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input placeholder="asset" value={asset} onChange={(e) => setAsset(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="reftag mono">{ref.id}</div>
          )}
          {note && <div className="muted">{note}</div>}
          <button className="primary" onClick={add}>Добавить в граф</button>
        </div>
      )}
    </div>
  );
}
