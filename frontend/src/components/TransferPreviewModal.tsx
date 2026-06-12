import { useEffect, useState } from "react";
import Modal from "./Modal";
import { networkColor } from "../lib/explorers";

export interface PickableTransfer {
  from?: string | null;
  to?: string | null;
  amount?: number;
  asset?: string;
  network?: string;
}

interface Props<T extends PickableTransfer> {
  transfers: T[];
  onAdd: (sel: T[]) => void;
  onClose: () => void;
  title?: string;
}

const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");

function TransferPreviewModal<T extends PickableTransfer>({
  transfers,
  onAdd,
  onClose,
  title = "Предпросмотр транзакций",
}: Props<T>) {
  const [selected, setSelected] = useState(() => new Set(transfers.map((_, i) => i)));

  // Capture-phase so the parent modal's Escape listener doesn't also fire.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [onClose]);

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

  return (
    <Modal title={title} onClose={onClose} width={620}>
      <div className="picker-header">
        <span style={{ color: "#9ca3af", fontSize: 12 }}>
          {transfers.length} переводов · выберите для импорта
        </span>
        <button className="link" onClick={toggleAll}>
          {selected.size === transfers.length ? "Снять все" : "Выбрать все"}
        </button>
      </div>

      <div className="transfer-picker-wrap">
        <div className="transfer-picker">
          {transfers.map((t, i) => (
            <label key={i} className={`trow${selected.has(i) ? " sel" : ""}`}>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              {t.network && (
                <span
                  className="badge"
                  style={{ background: networkColor(t.network as any), fontSize: 10, padding: "1px 5px" }}
                >
                  {t.network}
                </span>
              )}
              <span className="taddr">{short(t.from)}</span>
              <span className="tarrow">→</span>
              <span className="taddr" style={{ color: "#9ca3af" }}>{short(t.to)}</span>
              {t.amount != null && (
                <span className="tamt">
                  {t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {t.asset ?? ""}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onClose} style={{ flex: "none", width: "auto", padding: "8px 12px" }}>
          Отмена
        </button>
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
