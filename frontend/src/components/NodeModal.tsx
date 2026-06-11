import { useState } from "react";
import Modal from "./Modal";
import DetailsPanel from "./DetailsPanel";
import { store } from "../lib/store";
import { transfersSubgraph } from "../lib/graphMerge";
import { ALL_NETWORKS, type Network } from "../lib/explorers";
import { TAGS } from "../lib/tags";
import type { GEdge, GNode } from "../lib/graph";

interface Props {
  node: GNode;
  onClose: () => void;
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
  onMark: (id: string, patch: { tag?: string; note?: string }) => void;
}

export default function NodeModal({ node, onClose, onAdd, onMark }: Props) {
  const [tag, setTag] = useState(node.tag ?? "");
  const [note, setNote] = useState(node.note ?? "");
  const [marked, setMarked] = useState(false);

  function saveMark() {
    onMark(node.id, { tag: tag || undefined, note: note.trim() || undefined });
    setMarked(true);
    setTimeout(() => setMarked(false), 2000);
  }

  const isWallet = node.kind === "Wallet" && !!node.address;
  const [network, setNetwork] = useState<Network>(
    node.net && node.net !== "UNKNOWN" ? node.net : "ETH"
  );
  const [native, setNative] = useState(true);
  const [token, setToken] = useState(true);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!node.address) return;
    if (!native && !token) { setErr("Выберите нативные и/или токен-транзакции"); return; }
    setErr(null); setResult(null); setBusy(true);
    try {
      const { transfers, diag } = await store.walletTxs(network, node.address, { native, token, limit });
      if (!transfers.length) {
        setResult(diag ? `Эксплорер: ${diag}` : "Транзакций не найдено для этого адреса в выбранной сети.");
        return;
      }
      onAdd(transfersSubgraph(transfers));
      setResult(`Добавлено переводов: ${transfers.length}`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Узел" onClose={onClose} width={420}>
      <DetailsPanel node={node} />

      <div className="markbox">
        <strong>Маркировка</strong>
        <div className="ltrow">
          <label>Категория</label>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">— без метки —</option>
            {TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <input placeholder="заметка (необязательно)" value={note}
          onChange={(e) => setNote(e.target.value)} />
        <button className="primary" onClick={saveMark}>
          {marked ? "Сохранено ✓" : "Применить метку"}
        </button>
      </div>

      {isWallet && (
        <div className="loadtx">
          <strong>Загрузить транзакции кошелька</strong>
          <div className="ltrow">
            <label>Сеть</label>
            <select value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
              {ALL_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="ltchecks">
            <label><input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> Нативные</label>
            <label><input type="checkbox" checked={token} onChange={(e) => setToken(e.target.checked)} /> Токены</label>
            <label className="lim">лимит <input type="number" min={1} max={200} value={limit}
              onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} /></label>
          </div>

          {err && <div className="error">{err}</div>}
          {result && <div className="flash">{result}</div>}

          <button className="primary" onClick={load} disabled={busy}>
            {busy ? "Загрузка…" : "Загрузить и добавить в граф"}
          </button>
          <p className="muted">
            Для EVM-сетей нужен ETHERSCAN_API_KEY на сервере; TRON работает без ключа.
          </p>
        </div>
      )}
    </Modal>
  );
}
