import { tr, locale } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { networkColor } from "../lib/explorers";
import { hasUsdValue, readShowAllTransfers, transferIsVisible, writeShowAllTransfers } from "../lib/transferVisibility";

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
  tokenStatus?: "trusted" | "scam" | "unknown";
  tokenReason?: string | null;
}

interface Props<T extends PickableTransfer> {
  transfers: T[];
  onAdd: (sel: T[]) => void;
  onClose: () => void;
  title?: string;
}

const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");

const fmtDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleString(locale(), { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

const fmtUsd = (v?: number) =>
  v == null ? "" : "$" + v.toLocaleString(locale(), { maximumFractionDigits: v < 1 ? 4 : 0 });

const fmtAmt = (v?: number) =>
  v == null ? "" : v.toLocaleString(locale(), { maximumFractionDigits: 4 });

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
  title = tr("Предпросмотр транзакций"),
}: Props<T>) {
  const [showAll, setShowAll] = useState(readShowAllTransfers);
  const [selected, setSelected] = useState(() => new Set(transfers.flatMap((t, i) => transferIsVisible(t, readShowAllTransfers()) ? [i] : [])));
  const visible = useMemo(() => transfers.map((t, i) => ({ t, i })).filter(({ t }) => transferIsVisible(t, showAll)), [transfers, showAll]);
  const hiddenCount = transfers.filter((t) => !hasUsdValue(t)).length;
  const allVisibleSelected = visible.length > 0 && visible.every(({ i }) => selected.has(i));

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [onClose]);

  const totalUsd = useMemo(
    () => transfers.reduce((s, t, i) => (selected.has(i) && transferIsVisible(t, showAll) ? s + (t.usdValue ?? 0) : s), 0),
    [transfers, selected, showAll]
  );

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (visible.length > 0 && visible.every(({ i }) => prev.has(i)) ? new Set() : new Set(visible.map(({ i }) => i))));
  }

  return (
    <Modal title={title} onClose={onClose} width={960}>
      <div className="picker-header">
        <label><input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); writeShowAllTransfers(e.target.checked); if (!e.target.checked) setSelected((old) => new Set([...old].filter((i) => hasUsdValue(transfers[i])))); }} /> {tr("показать все транзакции ({n})", { n: hiddenCount })}</label>
        <span style={{ color: "#9ca3af", fontSize: 12 }}>
          {visible.length} {tr("переводов")}{totalUsd > 0 ? ` · ${tr("выбрано ≈ ${usd}", { usd: totalUsd.toLocaleString(locale(), { maximumFractionDigits: 0 }) })}` : ""}
        </span>
        <button className="link" onClick={toggleAll}>
          {allVisibleSelected ? tr("Снять все") : tr("Выбрать все")}
        </button>
      </div>

      <div className="transfer-picker-wrap wide">
        <table className="transfer-table">
          <thead>
            <tr>
              <th></th><th>{tr("Сеть")}</th><th>{tr("Дата")}</th><th>{tr("Отправитель")}</th><th></th>
              <th>{tr("Получатель")}</th><th className="num">{tr("Сумма")}</th><th className="num">USD</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ t, i }) => (
              <tr
                key={i}
                className={`${selected.has(i) ? "sel" : ""}${t.fromLabel || t.toLabel ? " tagged" : ""}${t.tokenStatus === "scam" ? " scam-row" : ""}`}
                onClick={() => toggle(i)}
              >
                <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                <td>{t.network && <span className="badge" style={{ background: networkColor(t.network as any) }}>{t.network}</span>}</td>
                <td className="tdate">{fmtDate(t.timestamp)}</td>
                <td><Addr addr={t.from} label={t.fromLabel} /></td>
                <td className="tarrow">→</td>
                <td><Addr addr={t.to} label={t.toLabel} /></td>
                <td className="num tamt">{fmtAmt(t.amount)} {t.asset ?? ""}{t.tokenStatus === "scam" && <span className="scam-badge" title={t.tokenReason ?? ""}>{tr("скам")}</span>}</td>
                <td className="num tusd">{fmtUsd(t.usdValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onClose} style={{ flex: "none", width: "auto", padding: "8px 12px" }}>{tr("Отмена")}</button>
        <button onClick={() => { onAdd(visible.map(({ t }) => t)); onClose(); }} style={{ flex: 1 }}>
          {tr("Добавить все (")}{visible.length})
        </button>
        <button
          className="primary"
          onClick={() => { onAdd(visible.filter(({ i }) => selected.has(i)).map(({ t }) => t)); onClose(); }}
          disabled={selected.size === 0}
          style={{ flex: 1 }}
        >
          {tr("Добавить выбранные (")}{selected.size})
        </button>
      </div>
    </Modal>
  );
}

export default TransferPreviewModal;
