import { useState } from "react";
import {
  autoDetect, detectEncoding, ENCODINGS, parseFiles,
  type Field, type Mapping, type ParsedCsv,
} from "../lib/csv";
import { buildGraph, type BuiltGraph } from "../lib/graph";

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
  return probe.includes("�") || /[ÐÑÂÃ][\x80-\xBF]/.test(probe);
}

export default function DataLoader({ onBuild }: { onBuild: (g: BuiltGraph) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [encoding, setEncoding] = useState("utf-8");
  const [userEnc, setUserEnc] = useState(false);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    e.target.value = ""; // allow re-selecting the same file
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

  function build() {
    if (!parsed || !mapping) return;
    if (!mapping.address && !mapping.txid && !mapping.txurl) {
      setErr("Укажите хотя бы колонку адреса или транзакции.");
      return;
    }
    onBuild(buildGraph(parsed.rows, mapping));
  }

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
          <button className="primary" onClick={build}>Построить граф</button>
        </>
      )}
    </div>
  );
}
