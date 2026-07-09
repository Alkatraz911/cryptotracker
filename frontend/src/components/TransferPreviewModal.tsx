import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { networkColor } from "../lib/explorers";

export interface PickableTransfer {
  from?: string | null;
  to?: string | null;
  amount?: number;
  asset?: string;
  network?: string;
  timestamp?: number;
  usdValue?: number;
  fromLabel?: string | null;
  toLabel?: string | null;
}

interface Props<T extends PickableTransfer> {
  transfers: T[];
  onAdd: (sel: T[]) => void;
  onClose: () => void;
  title?: string;
}

const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");

const fmtDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const fmtUsd = (v?: number) =>
  v == null ? "" : "$" + v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 4 : 0 });

const fmtAmt = (v?: number) =>
  v == null ? "" : v.toLocaleString(undefined, { maximumFractionDigits: 4 });

function Addr({ addr, label }: { addr?: string | null; label?: string | null }) {
  return (
    <span className="taddr">
      {label ? <span className="tagchip" title={`${label}\n${addr ?? ""}`}>{label}</span> : null}
      <span className="mono">{short(addr)}</span>
    </span>
  );
}

function TransferPreviewModal<T extends PickableTransfer>({
  transfers,
  onAdd,
  onClose,
  title = "Предпросмотр транзакций",
}: Props<T>) {
  const [selected, setSelected] = useState(() => new Set(transfers.map((_, i) => i)));

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [onClose]);

  const totalUsd = useMemo(
    () => transfers.reduce((s, t, i) => (selected.has(i) ? s + (t.usdValue ?? 0) : s), 0),
    [transfers, selected]
  );

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === transfers.length ? new Set() : new Set(transfers.map((_, i) => i))));
  }

  return (
    <Modal title={title} onClose={onClose} width={960}>
      <div className="picker-header">
        <span style={{ color: "#9ca3af", fontSize: 12 }}>
          {transfers.length} переводов{totalUsd > 0 ? ` · выбрано ≈ $${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
        </span>
        <button className="link" onClick={toggleAll}>
          {selected.size === transfers.length ? "Снять все" : "Выбрать все"}
        </button>
      </div>

      <div className="transfer-picker-wrap wide">
        <table className="transfer-table">
          <thead>
            <tr>
              <th></th><th>Сеть</th><th>Дата</th><th>Отправитель</th><th></th>
              <th>Получатель</th><th className="num">Сумма</th><th className="num">USD</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t, i) => (
              <tr
                key={i}
                className={`${selected.has(i) ? "sel" : ""}${t.fromLabel || t.toLabel ? " tagged" : ""}`}
                onClick={() => toggle(i)}
              >
                <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                <td>{t.network && <span className="badge" style={{ background: networkColor(t.network as any) }}>{t.network}</span>}</td>
                <td className="tdate">{fmtDate(t.timestamp)}</td>
                <td><Addr addr={t.from} label={t.fromLabel} /></td>
                <td className="tarrow">→</td>
                <td><Addr addr={t.to} label={t.toLabel} /></td>
                <td className="num tamt">{fmtAmt(t.amount)} {t.asset ?? ""}</td>
                <td className="num tusd">{fmtUsd(t.usdValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onClose} style={{ flex: "none", width: "auto", padding: "8px 12px" }}>Отмена</button>
        <button onClick={() => { onAdd(transfers); onClose(); }} style={{ flex: 1 }}>
          Добавить все ({transfers.length})
        </button>
        <button
          className="primary"
          onClick={() => { onAdd(transfers.filter((_, i) => selected.has(i))); onClose(); }}
          disabled={selected.size === 0}
          style={{ flex: 1 }}
        >
          Добавить выбранные ({selected.size})
        </button>
      </div>
    </Modal>
  );
}

export default TransferPreviewModal;
