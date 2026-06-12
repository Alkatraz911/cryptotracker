import { useState } from "react";
import {
  autoDetect, detectEncoding, ENCODINGS, parseFiles,
  type Field, type Mapping, type ParsedCsv,
} from "../lib/csv";
import { buildGraph, type BuiltGraph } from "../lib/graph";
import {
  hashFromUrl, networkColor, networkFromAddress, networkFromUrl, normalizeNetwork,
} from "../lib/explorers";

const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "uid", label: "User / UID" },
  { key: "exchange", label: "Exchange" },
  { key: "network", label: "Network / Chain" },
  { key: "address", label: "Wallet address", required: true },
  { key: "txid", label: "Tx hash / id" },
  { key: "txurl", label: "Tx explorer link" },
  { key: "amount", label: "Amount" },
  { key: "coin", label: "Coin / asset" },
  { key: "ip", label: "IP" },
  { key: "timestamp", label: "Timestamp" },
];

function looksMojibake(p: ParsedCsv): boolean {
  const probe = p.headers.join("") + (p.rows[0] ? Object.values(p.rows[0]).join("") : "");
  return probe.includes("â€") || probe.includes("ÐÑ") || /[ÐÑÂÃ][\x80-\xBF]/.test(probe);
}

interface PickerRow {
  rowIdx: number; // index into parsed.rows
  uid?: string;
  net: string;
  address?: string;
  hash?: string;
  amount?: number;
  asset?: string;
  ip?: string;
}

const short = (s: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");
const fmtAmt = (n: number) =>
  n < 0.0001 ? n.toExponential(2) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });

function extractPickerRows(rows: Record<string, string>[], m: Mapping): PickerRow[] {
  return rows
    .map((row, i) => {
      const rawAddr = m.address ? (row[m.address] ?? "").trim() : "";
      const rawUrl = m.txurl ? (row[m.txurl] ?? "").trim() : "";
      let net = normalizeNetwork(m.network ? (row[m.network] ?? "").trim() : "");
      if (net === "UNKNOWN" && rawUrl) net = networkFromUrl(rawUrl);
      if (net === "UNKNOWN" && rawAddr) net = networkFromAddress(rawAddr);
      const hash =
        (m.txid ? (row[m.txid] ?? "").trim() : undefined) ||
        (rawUrl ? hashFromUrl(rawUrl) ?? undefined : undefined);
      return {
        rowIdx: i,
        uid: m.uid ? (row[m.uid] ?? "").trim() || undefined : undefined,
        net,
        address: rawAddr || undefined,
        hash: hash || undefined,
        amount: m.amount ? parseFloat(row[m.amount] ?? "") || undefined : undefined,
        asset: m.coin ? (row[m.coin] ?? "").trim() || undefined : undefined,
        ip: m.ip ? (row[m.ip] ?? "").trim() || undefined : undefined,
      } satisfies PickerRow;
    })
    .filter((r) => r.uid || r.address || r.hash || r.ip);
}

export default function DataLoader({ onBuild }: { onBuild: (g: BuiltGraph) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [encoding, setEncoding] = useState("utf-8");
  const [userEnc, setUserEnc] = useState(false);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // picker state — null means "mapping view", array means "picker view"
  const [pickerRows, setPickerRows] = useState<PickerRow[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function reparse(fs: File[], enc: string, redetect: boolean) {
    if (!fs.length) { setParsed(null); setMapping(null); return; }
    try {
      const p = await parseFiles(fs, enc);
      if (!p.rows.length) throw new Error("В файлах нет строк данных");
      setParsed(p);
      setMapping((cur) => (redetect || !cur ? autoDetect(p.headers, p.rows[0]) : cur));
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    const all = [...files, ...picked];
    let enc = encoding;
    if (!userEnc && !/\.(xlsx|xls)$/i.test(picked[0].name)) {
      enc = detectEncoding(await picked[0].arrayBuffer());
      setEncoding(enc);
    }
    setFiles(all);
    await reparse(all, enc, true);
  }

  function onEncoding(enc: string) {
    setEncoding(enc);
    setUserEnc(true);
    reparse(files, enc, false);
  }

  function removeFile(i: number) {
    const all = files.filter((_, j) => j !== i);
    setFiles(all);
    reparse(all, encoding, all.length === 0);
  }

  function openPicker() {
    if (!parsed || !mapping) return;
    if (!mapping.address && !mapping.txid && !mapping.txurl) {
      setErr("Укажите хотя бы колонку адреса или транзакции.");
      return;
    }
    const rows = extractPickerRows(parsed.rows, mapping);
    if (!rows.length) {
      setErr("Не найдено строк с данными (адресом, транзакцией или IP).");
      return;
    }
    setErr(null);
    setPickerRows(rows);
    setSelected(new Set(rows.map((r) => r.rowIdx)));
  }

  function toggle(rowIdx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(rowIdx) ? next.delete(rowIdx) : next.add(rowIdx);
      return next;
    });
  }

  function toggleAll() {
    if (!pickerRows) return;
    setSelected((prev) =>
      prev.size === pickerRows.length
        ? new Set()
        : new Set(pickerRows.map((r) => r.rowIdx))
    );
  }

  function buildSelected() {
    if (!parsed || !mapping) return;
    const rows = parsed.rows.filter((_, i) => selected.has(i));
    onBuild(buildGraph(rows, mapping));
  }

  function buildAll() {
    if (!parsed || !mapping) return;
    onBuild(buildGraph(parsed.rows, mapping));
  }

  // ── Picker view ──────────────────────────────────────────────────────────
  if (pickerRows) {
    return (
      <div className="loader">
        <div className="picker-header" style={{ marginBottom: 8 }}>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>
            {pickerRows.length} строк · выберите для импорта
          </span>
          <button className="link" onClick={toggleAll}>
            {selected.size === pickerRows.length ? "Снять все" : "Выбрать все"}
          </button>
        </div>
        <div className="transfer-picker-wrap">
        <div className="transfer-picker">
          {pickerRows.map((r) => (
            <label key={r.rowIdx} className={`trow${selected.has(r.rowIdx) ? " sel" : ""}`}>
              <input
                type="checkbox"
                checked={selected.has(r.rowIdx)}
                onChange={() => toggle(r.rowIdx)}
              />
              {r.net !== "UNKNOWN" && (
                <span
                  className="badge"
                  style={{ background: networkColor(r.net as any), fontSize: 10, padding: "1px 5px" }}
                >
                  {r.net}
                </span>
              )}
              {r.uid && <span style={{ fontSize: 10, color: "#a78bfa" }}>UID:{r.uid}</span>}
              {r.address && <span className="taddr">{short(r.address)}</span>}
              {r.hash && (
                <>
                  {r.address && <span className="tarrow">→</span>}
                  <span className="taddr" style={{ color: "#9ca3af" }}>tx:{short(r.hash)}</span>
                </>
              )}
              {r.ip && <span style={{ fontSize: 10, color: "#f59e0b" }}>{r.ip}</span>}
              {r.amount != null && (
                <span className="tamt">{fmtAmt(r.amount)} {r.asset ?? ""}</span>
              )}
            </label>
          ))}
        </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button onClick={() => { setPickerRows(null); setErr(null); }} style={{ flex: "none", width: "auto", padding: "8px 12px" }}>
            ← Назад
          </button>
          <button onClick={buildAll} style={{ flex: 1 }}>
            Загрузить все ({parsed!.rows.length})
          </button>
          <button
            className="primary"
            onClick={buildSelected}
            disabled={selected.size === 0}
            style={{ flex: 1 }}
          >
            Загрузить выбранные ({selected.size})
          </button>
        </div>
      </div>
    );
  }

  // ── Mapping view ─────────────────────────────────────────────────────────
  return (
    <div className="loader">
      <label className="filebtn">
        + Добавить CSV / XLSX (можно несколько)
        <input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple onChange={onPick} hidden />
      </label>

      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f, i) => (
            <li key={i}>
              <span className="fname">{f.name}</span>
              <button className="rm" onClick={() => removeFile(i)} title="Убрать">×</button>
            </li>
          ))}
        </ul>
      )}

      <label className="encrow">
        Кодировка
        <select value={encoding} onChange={(e) => onEncoding(e.target.value)}>
          {ENCODINGS.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </label>

      {err && <div className="error">{err}</div>}

      {parsed && looksMojibake(parsed) && (
        <div className="warn-inline">
          Похоже на неверную кодировку (кракозябры). Попробуйте Windows-1251.
        </div>
      )}

      {parsed && mapping && (
        <>
          <p className="muted">
            {parsed.files.length} файл(ов) · {parsed.rows.length} строк · сопоставьте колонки:
          </p>
          <div className="mapgrid">
            {FIELDS.map((f) => (
              <label key={f.key} className="maprow">
                <span>{f.label}{f.required && <i className="req">*</i>}</span>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                >
                  <option value="">—</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button className="primary" onClick={openPicker}>Предпросмотр →</button>
        </>
      )}
    </div>
  );
}
