// CSV / XLSX parsing (client-side) + auto-detection of which column means what.
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Field =
  | "uid"
  | "exchange"
  | "network"
  | "address"
  | "txid"
  | "txurl"
  | "amount"
  | "coin"
  | "ip"
  | "timestamp";

// Which CSV header maps to each logical field. null = not present.
export type Mapping = Record<Field, string | null>;

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  files: { name: string; rows: number }[];
}

// Popular encodings for exchange exports (windows-1251 = Cyrillic mojibake fix).
export const ENCODINGS = [
  { id: "utf-8", label: "UTF-8" },
  { id: "windows-1251", label: "Windows-1251 (кириллица)" },
  { id: "utf-16le", label: "UTF-16 LE" },
  { id: "utf-16be", label: "UTF-16 BE" },
  { id: "windows-1252", label: "Windows-1252 / Latin-1" },
];

// Guess encoding: BOM first, then strict UTF-8 check, else assume cp1251.
export function detectEncoding(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return "utf-16le";
  if (b[0] === 0xfe && b[1] === 0xff) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return "utf-8";
  } catch {
    return "windows-1251";
  }
}

function decode(buf: ArrayBuffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

type Table = { headers: string[]; rows: Record<string, string>[] };

function parseText(text: string): Table {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return { headers: res.meta.fields ?? [], rows: res.data };
}

function parseXlsx(buf: ArrayBuffer): Table {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = (aoa[0] ?? []).map((h) => String(h).trim());
  const rows = aoa.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")]))
  );
  return { headers, rows };
}

const isXlsx = (name: string) => /\.(xlsx|xls)$/i.test(name);

// Parse one file: XLSX by extension (encoding ignored), else CSV with encoding.
async function parseFile(file: File, encoding: string): Promise<Table> {
  const buf = await file.arrayBuffer();
  return isXlsx(file.name) ? parseXlsx(buf) : parseText(decode(buf, encoding));
}

export async function parseOne(file: File, encoding: string): Promise<ParsedCsv> {
  const { headers, rows } = await parseFile(file, encoding);
  return { headers, rows, files: [{ name: file.name, rows: rows.length }] };
}

// Parse many files (mixed CSV/XLSX), merge rows, union headers (order preserved).
export async function parseFiles(files: File[], encoding: string): Promise<ParsedCsv> {
  const headers: string[] = [];
  const seen = new Set<string>();
  const rows: Record<string, string>[] = [];
  const fileInfo: { name: string; rows: number }[] = [];

  for (const file of files) {
    const p = await parseFile(file, encoding);
    for (const h of p.headers) if (!seen.has(h)) { seen.add(h); headers.push(h); }
    rows.push(...p.rows);
    fileInfo.push({ name: file.name, rows: p.rows.length });
  }
  return { headers, rows, files: fileInfo };
}

// Header-name hints (lowercased, substring match) for each field.
const HINTS: Record<Field, string[]> = {
  uid: ["user_id", "userid", "uid", "user id", "account_id", "member_id", "user"],
  exchange: ["exchange", "platform", "venue", "source"],
  network: ["network", "chain", "blockchain", "protocol"],
  address: [
    "to_address", "to address", "address", "wallet", "receiver",
    "destination", "to_addr", "withdraw_address", "recipient", "to",
  ],
  txid: ["tx_id", "txid", "txhash", "tx_hash", "hash", "transaction_id", "tx"],
  txurl: ["tx_url", "txlink", "tx_link", "link", "explorer", "url"],
  amount: ["amount", "value", "qty", "quantity", "size"],
  coin: ["coin", "asset", "token", "symbol", "currency"],
  ip: ["ip", "ip_address", "ipaddr", "login_ip", "client_ip"],
  timestamp: ["timestamp", "time", "date", "created", "datetime"],
};

const FIELD_ORDER: Field[] = [
  "uid", "exchange", "network", "address", "txid", "txurl",
  "amount", "coin", "ip", "timestamp",
];

export function autoDetect(headers: string[], sample?: Record<string, string>): Mapping {
  const lower = headers.map((h) => h.toLowerCase());
  const used = new Set<string>();
  const m = {} as Mapping;

  for (const field of FIELD_ORDER) {
    let pick: string | null = null;
    // exact match first, then substring
    for (const hint of HINTS[field]) {
      const exact = headers.find((h, i) => lower[i] === hint && !used.has(h));
      if (exact) { pick = exact; break; }
    }
    if (!pick) {
      for (const hint of HINTS[field]) {
        const sub = headers.find((h, i) => lower[i].includes(hint) && !used.has(h));
        if (sub) { pick = sub; break; }
      }
    }
    m[field] = pick;
    if (pick) used.add(pick);
  }

  // If no explicit txurl but a column's sample value looks like a URL, use it.
  if (!m.txurl && sample) {
    const urlCol = headers.find(
      (h) => !used.has(h) && /^https?:\/\//i.test((sample[h] ?? "").trim())
    );
    if (urlCol) { m.txurl = urlCol; used.add(urlCol); }
  }
  return m;
}
