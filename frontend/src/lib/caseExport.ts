// Case export (feature #2, part 3): turn the in-memory investigation into a
// reproducible artefact — a JSON case file, a PNG of the graph, or a printable
// report (→ PDF via the browser). The report bundles the graph snapshot, the
// on-canvas transactions, the investigator notes (annotations), the AI findings
// and the data-source list with timestamps, so the case can stand on its own.
import type { AiMsg, SourceHealth } from "./store";
import type { BuiltGraph, GAnnotation, GNode } from "./graph";

export interface CaseExtras {
  sources?: SourceHealth[];
  chats?: Record<string, AiMsg[]>; // nodeId → AI conversation
}

const slug = (s: string) => (s || "case").trim().replace(/[^\wа-яё\-]+/gi, "_").slice(0, 60) || "case";
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmtTs = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : "—");

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const nodeLabel = (n?: GNode) => (n ? (n.entityName ?? n.label.replace(/\n/g, " ")) : "—");

// Transactions currently on the canvas (Tx nodes), the case's transfer table.
function txRows(graph: BuiltGraph) {
  return graph.nodes
    .filter((n) => n.kind === "Tx")
    .map((n) => ({
      hash: n.hash ?? "", net: n.net ?? "", amount: n.amount ?? null,
      coin: n.coin ?? "", timestamp: n.timestamp ?? null, explorerUrl: n.explorerUrl ?? null,
    }))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

// ── JSON case file ─────────────────────────────────────────────────────────
export function buildCaseJson(name: string, graph: BuiltGraph, extras: CaseExtras = {}) {
  return {
    meta: { name: name || "Без названия", exportedAt: new Date().toISOString(), tool: "CryptoTracker" },
    stats: {
      nodes: graph.nodes.length, edges: graph.edges.length,
      annotations: (graph.annotations ?? []).length, transactions: txRows(graph).length,
    },
    graph: { nodes: graph.nodes, edges: graph.edges, annotations: graph.annotations ?? [] },
    transfers: txRows(graph),
    sources: extras.sources ?? [],
    ai: extras.chats ?? {},
  };
}

export function exportCaseJson(name: string, graph: BuiltGraph, extras: CaseExtras = {}) {
  const json = JSON.stringify(buildCaseJson(name, graph, extras), null, 2);
  triggerDownload(`${slug(name)}_${stamp()}.json`, new Blob([json], { type: "application/json" }));
}

// ── PNG snapshot of the graph ──────────────────────────────────────────────
export async function exportCasePng(name: string, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  triggerDownload(`${slug(name)}_${stamp()}.png`, blob);
}

// ── Printable report (→ PDF via the browser's print dialog) ────────────────
function buildReportHtml(name: string, graph: BuiltGraph, pngDataUrl: string | null, extras: CaseExtras): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const anns = (graph.annotations ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const txs = txRows(graph);
  const sources = extras.sources ?? [];
  const chats = extras.chats ?? {};

  const annRow = (a: GAnnotation) =>
    `<tr><td>${a.kind === "suspect" ? "🚩 подозрительно" : "📝 заметка"}</td>` +
    `<td>${a.nodeIds.map((id) => esc(nodeLabel(byId.get(id)))).join("<br>")}</td>` +
    `<td>${esc(a.text)}</td><td class="muted">${esc(fmtTs(a.createdAt))}</td></tr>`;

  const txRow = (t: ReturnType<typeof txRows>[number]) =>
    `<tr><td class="mono">${t.explorerUrl ? `<a href="${esc(t.explorerUrl)}">${esc(t.hash.slice(0, 18))}…</a>` : esc(t.hash.slice(0, 18)) + "…"}</td>` +
    `<td>${esc(t.net)}</td><td class="num">${t.amount ?? ""} ${esc(t.coin)}</td>` +
    `<td class="muted">${esc(fmtTs(t.timestamp))}</td></tr>`;

  const srcRow = (s: SourceHealth) =>
    `<tr><td>${esc(s.source)}</td><td>${esc(s.status)}</td>` +
    `<td class="muted">${esc(fmtTs(s.lastOkAt))}</td><td class="muted">${esc(fmtTs(s.lastFailAt))}</td></tr>`;

  const aiBlocks = Object.entries(chats)
    .filter(([, msgs]) => msgs?.some((m) => m.role === "assistant"))
    .map(([nodeId, msgs]) => {
      const body = msgs
        .filter((m) => m.role === "assistant")
        .map((m) => `<p>${esc(m.text)}</p>`)
        .join("");
      return `<div class="ai-node"><h3>${esc(nodeLabel(byId.get(nodeId)))}</h3>${body}</div>`;
    })
    .join("");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>${esc(name || "Дело")} — отчёт</title>
<style>
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 6px; }
  .stats { display: flex; gap: 18px; margin: 8px 0 4px; font-size: 12px; }
  .stats b { font-size: 16px; display: block; }
  img.snap { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; margin-top: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #ddd; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; } .num { text-align: right; } .mono { font-family: ui-monospace, monospace; }
  .muted { color: #777; } a { color: #2563eb; text-decoration: none; }
  .ai-node { border-left: 3px solid #a855f7; padding-left: 10px; margin: 10px 0; }
  @media print { body { margin: 12mm; } a { color: #111; } }
</style></head><body>
  <h1>${esc(name || "Дело без названия")}</h1>
  <div class="meta">CryptoTracker · экспортировано ${esc(new Date().toLocaleString())}</div>
  <div class="stats">
    <span><b>${graph.nodes.length}</b>узлов</span>
    <span><b>${graph.edges.length}</b>рёбер</span>
    <span><b>${txs.length}</b>транзакций</span>
    <span><b>${anns.length}</b>заметок</span>
  </div>
  ${pngDataUrl ? `<h2>Граф</h2><img class="snap" src="${pngDataUrl}" alt="граф">` : ""}
  ${anns.length ? `<h2>Заметки дела</h2><table><thead><tr><th>Тип</th><th>Узлы</th><th>Текст</th><th>Дата</th></tr></thead><tbody>${anns.map(annRow).join("")}</tbody></table>` : ""}
  ${aiBlocks ? `<h2>ИИ-выводы</h2>${aiBlocks}` : ""}
  ${txs.length ? `<h2>Транзакции (${txs.length})</h2><table><thead><tr><th>Хеш</th><th>Сеть</th><th class="num">Сумма</th><th>Время</th></tr></thead><tbody>${txs.slice(0, 500).map(txRow).join("")}</tbody></table>` : ""}
  ${sources.length ? `<h2>Источники данных</h2><table><thead><tr><th>Источник</th><th>Статус</th><th>Последний успех</th><th>Последний сбой</th></tr></thead><tbody>${sources.map(srcRow).join("")}</tbody></table>` : ""}
</body></html>`;
}

export function openCaseReport(name: string, graph: BuiltGraph, pngDataUrl: string | null, extras: CaseExtras = {}) {
  const w = window.open("", "_blank");
  if (!w) return false; // popup blocked
  w.document.write(buildReportHtml(name, graph, pngDataUrl, extras));
  w.document.close();
  // Give the embedded snapshot a moment to decode before invoking print.
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can print manually */ } }, 400);
  return true;
}
