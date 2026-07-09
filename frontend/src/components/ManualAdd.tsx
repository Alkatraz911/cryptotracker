import { useState } from "react";
import { parseExplorerUrl, networkFromAddress, type ExplorerRef, type Network } from "../lib/explorers";
import { store, type TxTransfer } from "../lib/store";
import { txSubgraph, walletNode } from "../lib/graphMerge";
import TransferPreviewModal from "./TransferPreviewModal";
import type { GEdge, GNode } from "../lib/graph";

interface Props {
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
}

const EVM_NETWORKS: Network[] = ["ETH", "BSC", "POLYGON", "ARBITRUM", "BASE"];

function guessKind(input: string, net: Network): "tx" | "address" {
  if (net === "SOLANA") return input.length > 50 ? "tx" : "address";
  if (net === "TRON") return /^[0-9a-fA-F]{64}$/.test(input) ? "tx" : "address";
  return "address";
}

function parseRawInput(input: string): ExplorerRef | null {
  const u = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(u)) return { kind: "address", network: "UNKNOWN", id: u };
  if (/^0x[0-9a-fA-F]{64}$/.test(u)) return { kind: "tx",      network: "UNKNOWN", id: u };
  // A bare 64-hex string (no 0x) is a TRON transaction hash — TRON addresses are
  // base58 (start with T), and EVM hashes are pasted with the 0x prefix.
  if (/^[0-9a-fA-F]{64}$/.test(u)) return { kind: "tx", network: "TRON", id: u };
  const net = networkFromAddress(u);
  if (net === "UNKNOWN") return null;
  return { kind: guessKind(u, net), network: net, id: u };
}

export default function ManualAdd({ onAdd }: Props) {
  const [input, setInput] = useState("");
  const [ref, setRef] = useState<ExplorerRef | null>(null);
  const [netChoice, setNetChoice] = useState<Network>("ETH");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("");
  const [transfers, setTransfers] = useState<TxTransfer[]>([]);
  const [ts, setTs] = useState<number | undefined>(undefined);
  const [showPicker, setShowPicker] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRef(null); setFrom(""); setTo(""); setAmount(""); setAsset(""); setNote(null);
    setTransfers([]); setTs(undefined); setShowPicker(false);
  }

  async function recognize() {
    setErr(null); setNote(null);
    const u = input.trim();
    if (!u) return;
    const r = parseExplorerUrl(u) ?? parseRawInput(u);
    if (!r) { setErr("Вставьте ссылку, адрес кошелька или хеш транзакции"); return; }
    if (r.network === "UNKNOWN") {
      setRef(r);
      return;
    }
    await resolveRef(r);
  }

  async function confirmNetwork() {
    if (!ref) return;
    await resolveRef({ ...ref, network: netChoice });
  }

  async function resolveRef(r: ExplorerRef) {
    setRef(r);
    setErr(null);
    if (r.kind !== "tx") return;
    setBusy(true);
    try {
      const { data, diag } = await store.explorerTx(r.network, r.id);
      if (data) {
        setTs(data.timestamp);
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
          : "API не вернул данные. Заполните from/to/сумму вручную.");
      }
    } catch (e: any) {
      setNote("Не удалось подтянуть данные. Заполните вручную. " + (e.message ?? ""));
    } finally {
      setBusy(false);
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
        timestamp: ts,
      }));
    }
    setInput(""); reset();
  }

  function addFromPicker(sel: TxTransfer[]) {
    if (!ref || !sel.length) return;
    const nodeMap = new Map<string, GNode>();
    const edgeMap = new Map<string, GEdge>();
    for (const t of sel) {
      const sub = txSubgraph({ net: ref.network, hash: ref.id, from: t.from, to: t.to, amount: t.amount, asset: t.asset, timestamp: ts });
      for (const n of sub.nodes) nodeMap.set(n.id, n);
      for (const e of sub.edges) edgeMap.set(e.id, e);
    }
    onAdd({ nodes: [...nodeMap.values()], edges: [...edgeMap.values()] });
    setInput(""); reset();
  }

  const needNetPick = ref?.network === "UNKNOWN";
  const resolved = ref && ref.network !== "UNKNOWN";

  return (
    <div className="manual">
      <strong>Добавить адрес или транзакцию</strong>
      <div className="urlrow">
        <input
          placeholder="ссылка, адрес кошелька или хеш tx"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && input.trim() && recognize()}
        />
        <button onClick={recognize} disabled={busy || !input.trim()}>
          {busy ? "…" : "→"}
        </button>
      </div>

      {err && <div className="error">{err}</div>}

      {needNetPick && (
        <div className="manualform">
          <div className="reftag">{ref!.kind === "tx" ? "Транзакция" : "Кошелёк"} · EVM — выберите сеть</div>
          <div className="reftag mono">{ref!.id}</div>
          <div className="ltrow" style={{ marginTop: 8 }}>
            <select
              value={netChoice}
              onChange={(e) => setNetChoice(e.target.value as Network)}
              style={{ flex: 1 }}
            >
              {EVM_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button
              className="primary"
              onClick={confirmNetwork}
              style={{ margin: 0, width: "auto", padding: "6px 12px" }}
            >
              Подтвердить
            </button>
          </div>
        </div>
      )}

      {resolved && (
        <div className="manualform">
          <div className="reftag">{ref!.kind === "tx" ? "Транзакция" : "Кошелёк"} · {ref!.network}</div>

          {ref!.kind === "tx" && transfers.length <= 1 && (
            <>
              <input placeholder="from address" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input placeholder="to address" value={to} onChange={(e) => setTo(e.target.value)} />
              <div className="row2">
                <input placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input placeholder="asset" value={asset} onChange={(e) => setAsset(e.target.value)} />
              </div>
            </>
          )}

          {ref!.kind === "address" && <div className="reftag mono">{ref!.id}</div>}

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
