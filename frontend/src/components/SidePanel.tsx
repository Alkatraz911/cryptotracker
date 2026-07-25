import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// AI chat is opened on demand — load it lazily so it isn't in the initial bundle.
const AiChat = lazy(() => import("./AiChat"));
import { store, type AiMsg, type NodeNetCache, type SourceStatus, type Transfer, type WalletBalance } from "../lib/store";
import { transfersSubgraph, bridgeSubgraph, annotationsForNodeView } from "../lib/graphMerge";
import { chainIdForNode, bridgeForTx, bridgeAnchorForTx } from "../lib/orbiter";
import { ALL_NETWORKS, networkColor, txUrl, walletNodeId, type Network } from "../lib/explorers";
import { nodeIsRisky } from "../lib/tags";
import type { AnnotationKind, BuiltGraph, GAnnotation, GEdge, GNode } from "../lib/graph";

interface Props {
  node: GNode;
  graph: BuiltGraph;
  onClose: () => void;
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
  onRemove: (id: string) => void;
  onSaveAnnotation: (ann: GAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onLabel: (id: string, entityName: string, bridge?: string) => void;
  onSetNet: (id: string, net: Network) => void;
  onUnmerge: (id: string) => void;
  onTrace: (node: GNode, opts: { network: Network; direction: "out" | "in"; hops: number; minUsd: number }) => Promise<string>;
  onFocus: (id: string) => void;
  onPatchNode: (id: string, patch: Partial<GNode>) => void;
  cache: Record<string, NodeNetCache>;
  onCacheNet: (net: string, patch: NodeNetCache) => void;
  chat: AiMsg[];
  onChatChange: (msgs: AiMsg[]) => void;
}

type Tab = "overview" | "txs" | "links" | "ai";
type NetState = { transfers: Transfer[]; loading: boolean; err?: string; diag?: string; status?: SourceStatus };
type BalState = { bal: WalletBalance | null; loading: boolean };

const NA = "не определено";
const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");
const fmtDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtUsd = (v?: number) =>
  v == null ? "" : "$" + v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 0 });
const fmtAmt = (v?: number) =>
  v == null ? "" : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const sumUsd = (ts: { usdValue?: number }[]) => ts.reduce((s, t) => s + (t.usdValue ?? 0), 0);

// Headline balance value: total USD across all holdings, else the largest
// holding's amount, else "не определено".
function balanceValue(bal?: WalletBalance | null): string {
  if (!bal || !bal.holdings.length) return NA;
  if (bal.totalUsd != null) return fmtUsd(bal.totalUsd);
  const top = bal.holdings[0];
  return `${fmtAmt(top.amount)} ${top.asset}`;
}
// Tooltip: per-asset breakdown.
function balanceTitle(bal?: WalletBalance | null): string {
  if (!bal || !bal.holdings.length) return "Ончейн-баланс выбранной сети (нативный токен + токены)";
  return bal.holdings
    .map((h) => `${fmtAmt(h.amount)} ${h.asset}${h.usdValue != null ? ` (${fmtUsd(h.usdValue)})` : ""}`)
    .join("\n");
}

export default function SidePanel(props: Props) {
  const { node, graph, onClose, onAdd, onFocus, onPatchNode, cache, onCacheNet, chat, onChatChange } = props;
  const [tab, setTab] = useState<Tab>("overview");

  const isWallet = node.kind === "Wallet" && !!node.address;
  const isTx = node.kind === "Tx";
  const isAgg = isTx && !!node.aggregated; // folded multi-transfer Tx node
  const addr = node.address?.toLowerCase();
  const risky = nodeIsRisky(node.tag, node.entityName);

  // Address → entity label from the graph's already-labelled nodes, so the tx
  // list and Связи tab show tags (Orbiter/exchange/…) even when the transfer rows
  // weren't enriched at fetch time (the backend caps label lookups per request).
  const labelByAddr = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) if (n.address && n.entityName) m.set(n.address.toLowerCase(), n.entityName);
    return m;
  }, [graph.nodes]);

  // Backfill a missing Tx date on demand (e.g. older graphs, or chains where the
  // scraped history didn't carry a timestamp). Patches the node so both the card
  // and its edge label pick up the date.
  const [dateBusy, setDateBusy] = useState(false);
  useEffect(() => {
    if (node.kind !== "Tx" || node.timestamp != null || !node.hash || !node.net || node.net === "UNKNOWN") return;
    let cancelled = false;
    setDateBusy(true);
    store.explorerTx(node.net, node.hash)
      .then(({ data }) => { if (!cancelled && data?.timestamp) onPatchNode(node.id, { timestamp: data.timestamp }); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDateBusy(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // Networks this wallet spans (EVM nodes are chain-agnostic → may span several).
  const nets = useMemo<Network[]>(() => {
    if (!isWallet) return [];
    const ns = node.nets?.length ? node.nets : (node.net && node.net !== "UNKNOWN" ? [node.net] : []);
    return ns.length ? ns : ["ETH"];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const [activeNet, setActiveNet] = useState<Network>(nets[0]);
  // Transfers + balance loaded per network — the metrics, the Транзакции table
  // and the Связи tab all reflect the currently selected network.
  const [byNet, setByNet] = useState<Record<string, NetState>>({});
  const [balByNet, setBalByNet] = useState<Record<string, BalState>>({});

  // Load the wallet's FULL stored history (no small cap) — the metrics, the
  // Транзакции default view and the Связи tab all reflect this set. Results are
  // written through to the project-level cache so they survive re-selection,
  // tab/node switches and reloads.
  async function loadNet(
    net: Network,
    opts: { native: boolean; token: boolean; limit: number; force?: boolean; from?: number; to?: number } = { native: true, token: true, limit: 2000 },
  ) {
    if (!node.address) return;
    setByNet((p) => ({ ...p, [net]: { transfers: p[net]?.transfers ?? [], loading: true } }));
    try {
      const { transfers, diag, status } = await store.walletTxs(net, node.address, opts);
      const d = transfers.length ? undefined : (diag ? `Эксплорер: ${diag}` : "Транзакций не найдено для этого адреса.");
      setByNet((p) => ({ ...p, [net]: { transfers, loading: false, diag: d, status } }));
      onCacheNet(net, { transfers, diag: d ?? null, status });
    } catch (e: any) {
      setByNet((p) => ({ ...p, [net]: { transfers: [], loading: false, err: e.message ?? String(e) } }));
    }
  }

  async function loadBalance(net: Network) {
    if (!node.address) return;
    setBalByNet((p) => ({ ...p, [net]: { bal: p[net]?.bal ?? null, loading: true } }));
    try {
      const bal = await store.walletBalance(net, node.address);
      setBalByNet((p) => ({ ...p, [net]: { bal, loading: false } }));
      onCacheNet(net, { bal });
    } catch {
      setBalByNet((p) => ({ ...p, [net]: { bal: null, loading: false } }));
    }
  }

  // Load a date-bounded slice of the wallet's stored history for the Транзакции
  // tab. Deliberately does NOT write the per-net cache, so the metrics/Связи keep
  // reflecting the full history while the table shows just the selected period.
  async function loadWindow(net: Network, from?: number, to?: number): Promise<{ transfers: Transfer[]; diag: string | null }> {
    if (!node.address) return { transfers: [], diag: null };
    return store.walletTxs(net, node.address, { native: true, token: true, limit: 2000, from, to });
  }

  // On node change: seed from the persistent cache; only fetch networks we have
  // not loaded before (so a node opened earlier never re-fetches).
  useEffect(() => {
    setTab(isAgg ? "txs" : "overview");
    const seededTx: Record<string, NetState> = {};
    const seededBal: Record<string, BalState> = {};
    for (const [net, c] of Object.entries(cache)) {
      if (c.transfers) seededTx[net] = { transfers: c.transfers, loading: false, diag: c.diag ?? undefined, status: c.status };
      if (c.bal) seededBal[net] = { bal: c.bal, loading: false };
    }
    setByNet(seededTx);
    setBalByNet(seededBal);
    const primary = (node.net && node.net !== "UNKNOWN" ? node.net : (node.nets?.[0] ?? "ETH")) as Network;
    setActiveNet(primary);
    if (node.kind === "Wallet" && node.address) {
      if (!seededTx[primary]) loadNet(primary);
      if (!seededBal[primary]) loadBalance(primary);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function selectNet(net: Network) {
    setActiveNet(net);
    if (!byNet[net]) loadNet(net);
    if (!balByNet[net]) loadBalance(net);
  }

  const cur = byNet[activeNet];
  const curBal = balByNet[activeNet];
  const txs = cur ? cur.transfers : null;
  const txLoading = isWallet && (cur ? cur.loading : true);
  const balLoading = isWallet && (curBal ? curBal.loading : true);
  const sent = useMemo(() => (txs && addr ? txs.filter((t) => t.from?.toLowerCase() === addr) : []), [txs, addr]);
  const recv = useMemo(() => (txs && addr ? txs.filter((t) => t.to?.toLowerCase() === addr) : []), [txs, addr]);
  const sentUsd = sumUsd(sent), recvUsd = sumUsd(recv);

  return (
    <aside className="sidepanel">
      <div className="sp-head">
        <span className="badge" style={{ background: node.color }}>{node.kind}</span>
        {isWallet ? (
          <div className="sp-nets">
            {nets.map((n) => (
              <button key={n} className={`sp-net-chip${n === activeNet ? " active" : ""}`}
                style={{ borderColor: networkColor(n), color: n === activeNet ? "#fff" : networkColor(n), background: n === activeNet ? networkColor(n) : "transparent" }}
                onClick={() => selectNet(n)}>{n}</button>
            ))}
          </div>
        ) : (
          node.net && node.net !== "UNKNOWN" && <span className="net">{node.chainName ?? node.net}</span>
        )}
        {risky && <span className="risk-pill">⚠ риск</span>}
        <button className="x sp-x" onClick={onClose} title="Закрыть">×</button>
      </div>

      <div className="sp-title">
        {node.entityName && <div className="sp-entity">{node.entityName}</div>}
        <div className="sp-addr">
          <code className="mono">{node.address ?? node.hash ?? node.ip ?? node.uid ?? short(node.id)}</code>
          {(node.address || node.hash) && (
            <button className="sp-copy" title="Скопировать"
              onClick={() => navigator.clipboard?.writeText(node.address ?? node.hash ?? "")}>⧉</button>
          )}
          {node.explorerUrl && (
            <a className="sp-ext" href={node.explorerUrl} target="_blank" rel="noopener" title="Открыть в эксплорере">↗</a>
          )}
        </div>
      </div>

      <div className="sp-metrics">
        {isWallet ? (
          <>
            <Metric label="Отправлено" loading={txLoading}
              value={txs ? String(sent.length) : NA} sub={txs && sentUsd > 0 ? fmtUsd(sentUsd) : undefined} />
            <Metric label="Получено" loading={txLoading}
              value={txs ? String(recv.length) : NA} sub={txs && recvUsd > 0 ? fmtUsd(recvUsd) : undefined} />
            <Metric label="Баланс" loading={balLoading}
              value={balanceValue(curBal?.bal)}
              sub={curBal?.bal && curBal.bal.holdings.length ? `${curBal.bal.holdings.length} актив.` : undefined}
              title={balanceTitle(curBal?.bal)} />
            <Metric label="Владелец" loading={txLoading && !node.entityName} value={node.entityName ?? NA} />
          </>
        ) : isAgg ? (
          <>
            <Metric label="Сумма" value={node.amount != null ? `${fmtAmt(node.amount)} ${node.coin ?? ""}` : `${node.members?.length ?? 0} перев.`} />
            <Metric label="Переводов" value={String(node.members?.length ?? 0)} />
            <Metric label="Период" value={node.tsFrom ? `${fmtDate(node.tsFrom)} — ${fmtDate(node.tsTo)}` : NA} />
            <Metric label="Сеть" value={node.net && node.net !== "UNKNOWN" ? node.net : NA} />
          </>
        ) : isTx ? (
          <>
            <Metric label="Сумма" value={node.amount != null ? fmtAmt(node.amount) : NA} />
            <Metric label="Актив" value={node.coin ?? NA} />
            <Metric label="Дата" loading={dateBusy} value={node.timestamp ? fmtDate(node.timestamp) : NA}
              sub={node.source ?? undefined} title={node.fetchedAt ? `загружено: ${fmtDate(node.fetchedAt)}` : undefined} />
            <Metric label="Сеть" value={node.chainName ?? (node.net && node.net !== "UNKNOWN" ? node.net : NA)} />
          </>
        ) : (
          <>
            <Metric label="Тип" value={node.kind} />
            <Metric label="Связи" value={String(node.degree)} />
          </>
        )}
      </div>

      <div className="sp-tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Обзор</button>
        {isWallet && <button className={tab === "txs" ? "active" : ""} onClick={() => setTab("txs")}>Транзакции{txs ? ` (${txs.length})` : ""}</button>}
        {isAgg && <button className={tab === "txs" ? "active" : ""} onClick={() => setTab("txs")}>Транзакции ({node.members?.length ?? 0})</button>}
        {isWallet && <button className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}>Связи</button>}
        <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>ИИ-чат{chat.length ? ` (${chat.filter((m) => m.role === "user").length || "•"})` : ""}</button>
      </div>

      <div className={`sp-body${tab === "ai" ? " sp-body-ai" : ""}${tab === "txs" ? " sp-body-txs" : ""}`}>
        {tab === "overview" && <OverviewTab {...props} isWallet={isWallet} isTx={node.kind === "Tx" && !!node.hash} />}
        {tab === "txs" && isWallet && (
          <TxTab
            activeNet={activeNet}
            onNet={selectNet}
            txs={txs}
            busy={!!cur?.loading}
            err={cur?.err ?? null}
            diag={cur?.diag ?? null}
            status={cur?.status}
            addr={addr}
            onLoadWindow={(from, to) => loadWindow(activeNet, from, to)}
            onRefresh={() => loadNet(activeNet, { native: true, token: true, limit: 2000, force: true })}
            onAddSelected={(sel) => onAdd(transfersSubgraph(sel))}
            labelByAddr={labelByAddr}
          />
        )}
        {tab === "txs" && isAgg && <AggTxTab node={node} />}
        {tab === "links" && isWallet && (
          <LinksTab txs={txs} addr={addr} onAdd={onAdd} onFocus={onFocus} labelByAddr={labelByAddr} />
        )}
        {tab === "ai" && (
          <Suspense fallback={<div className="ai-thinking">Загрузка ИИ-чата…</div>}>
            <AiChat key={node.id} graph={graph} focusId={node.id} messages={chat} onMessagesChange={onChatChange} />
          </Suspense>
        )}
      </div>

      {tab === "overview" && (
        <div className="sp-foot">
          <button className="primary" onClick={() => setTab("ai")}>💬 Открыть ИИ-чат по узлу</button>
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value, sub, loading, title }: { label: string; value: string; sub?: string; loading?: boolean; title?: string }) {
  const na = value === NA;
  return (
    <div className="sp-metric" title={title}>
      {loading
        ? <span className="sp-mv loading">Загрузка…</span>
        : <span className={`sp-mv${na ? " na" : ""}`} title={value}>{value}</span>}
      {sub && !loading && <span className="sp-msub">{sub}</span>}
      <span className="sp-ml">{label}</span>
    </div>
  );
}

// ── Overview tab — node actions (no details card, no category dropdown) ──────
type OverviewProps = Props & { isWallet: boolean; isTx: boolean };

function OverviewTab({
  node, graph, onAdd, onRemove, onSaveAnnotation, onDeleteAnnotation, onLabel, onSetNet, onUnmerge, onTrace,
  isWallet, isTx,
}: OverviewProps) {
  const isEntity = node.kind === "Entity" && !!node.mergedFrom;
  // The bridge id this tx leads to (by its counterparty), or undefined.
  const bridge = isTx ? bridgeForTx(node, graph.nodes, graph.edges) : undefined;
  // Which bridges support resolution (cross-chain button). Detection-only bridges
  // are still labelled but get no button.
  const [resolvers, setResolvers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (isTx) store.bridgeResolvers().then(setResolvers).catch(() => {}); }, [isTx]);
  const resolver = bridge ? resolvers.find((r) => r.id === bridge) : undefined;
  const bridgeName = resolver?.name ?? bridge ?? "";
  const bridgeChainId = chainIdForNode(node.net, node.chainId);
  // Any tx on a queryable chain is resolvable: target a detected bridge, or probe
  // every adapter when none is detected — so the button no longer depends on the
  // bridge contract being present + labelled as a graph neighbour.
  const canResolve = isTx && !!node.hash && !!bridgeChainId;
  const preferBridge = resolver ? bridge : undefined;
  // Case notes (Phase 4) for this node.
  const nodeAnnotations = annotationsForNodeView(graph, node);
  const [annText, setAnnText] = useState("");
  const [annKind, setAnnKind] = useState<AnnotationKind>("note");
  const [confirmDel, setConfirmDel] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelErr, setLabelErr] = useState<string | null>(null);
  const [netEdit, setNetEdit] = useState<Network>(node.net && node.net !== "UNKNOWN" ? node.net : "ETH");

  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeMsg, setBridgeMsg] = useState<string | null>(null);

  const [traceDir, setTraceDir] = useState<"out" | "in">("out");
  const [traceHops, setTraceHops] = useState(3);
  const [traceMinUsd, setTraceMinUsd] = useState(50);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceMsg, setTraceMsg] = useState<string | null>(null);

  useEffect(() => { setConfirmDel(false); setAnnText(""); setAnnKind("note"); }, [node.id]);

  async function fetchLabel() {
    if (!node.address || !node.net || node.net === "UNKNOWN") return;
    setLabelBusy(true); setLabelErr(null);
    try {
      const { label, bridge } = await store.addressLabel(node.net, node.address);
      if (label) onLabel(node.id, label, bridge);
      else setLabelErr("Метка не найдена для этого адреса.");
    } catch (e: any) { setLabelErr(e.message ?? "Ошибка запроса"); }
    finally { setLabelBusy(false); }
  }

  function addAnnotation() {
    const text = annText.trim();
    if (!text) return;
    const now = Date.now();
    onSaveAnnotation({ id: `ann_${now}_${Math.random().toString(36).slice(2, 8)}`, nodeIds: [node.id], text, kind: annKind, createdAt: now, updatedAt: now });
    setAnnText("");
    setAnnKind("note");
  }

  async function resolveBridge() {
    if (!node.hash) return;
    setBridgeBusy(true); setBridgeMsg(null);
    try {
      // Target the detected bridge if any; otherwise probe every adapter.
      const { hop, diag } = await store.orbiterResolve(node.hash, bridgeChainId, node.timestamp, preferBridge);
      if (hop) {
        // Anchor the cross-chain arrow on the bridge node (this tx's bridge-labelled
        // counterparty) so it emanates from the bridge, not the tx circle.
        const anchor = bridgeAnchorForTx(node, graph.nodes, graph.edges);
        onAdd(bridgeSubgraph(hop, anchor));
        const other = hop.sourceId.toLowerCase() === node.hash.toLowerCase()
          ? `${hop.targetChainName} (получено)` : `${hop.sourceChainName} (отправлено)`;
        const amt = hop.symbol ? `${hop.amount} ${hop.symbol}` : "перевод";
        setBridgeMsg(`Найден мост: ${amt} ↔ ${other}. Узел добавлен в граф.`);
      } else setBridgeMsg(diag ?? "Кроссчейн-перевод не найден.");
    } catch (e: any) { setBridgeMsg(e.message ?? "Ошибка запроса к мосту"); }
    finally { setBridgeBusy(false); }
  }

  async function runTrace() {
    const network = (node.net && node.net !== "UNKNOWN" ? node.net : "ETH") as Network;
    setTraceBusy(true); setTraceMsg(null);
    try {
      setTraceMsg(await onTrace(node, { network, direction: traceDir, hops: traceHops, minUsd: traceMinUsd }));
    } catch (e: any) { setTraceMsg(e.message ?? "Ошибка трейса"); }
    finally { setTraceBusy(false); }
  }

  return (
    <>
      {isEntity && (
        <div className="entitybox" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>Объединённая сущность · {node.mergedFrom!.length} узлов</strong>
          <ul className="aliaslist">
            {node.mergedFrom!.map((m) => (
              <li key={m.id}>
                <span className="ak">{m.kind}</span>
                <span className="av mono">{m.address ?? m.uid ?? m.ip ?? m.hash ?? m.label.replace("\n", " ")}</span>
                {m.net && m.net !== "UNKNOWN" && <span className="an">{m.net}</span>}
              </li>
            ))}
          </ul>
          <button onClick={() => onUnmerge(node.id)}>Разъединить</button>
        </div>
      )}

      {canResolve && (
        <div className="bridgebox" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>Кроссчейн-мост{resolver ? ` (${bridgeName})` : ""}</strong>
          <p className="muted">
            {resolver
              ? `Транзакция ведёт к мосту ${bridgeName}. Найти её продолжение в сети назначения.`
              : "Проверить кроссчейн-продолжение (Orbiter · deBridge · Across · LI.FI)."}
          </p>
          <button className="primary" onClick={resolveBridge} disabled={bridgeBusy}>
            {bridgeBusy ? "Поиск…" : "Найти кроссчейн-продолжение"}
          </button>
          {bridgeMsg && <div className="flash">{bridgeMsg}</div>}
        </div>
      )}

      {isWallet && (
        <div className={`netbox${node.net === "UNKNOWN" ? " netbox-warn" : ""}`} style={node.net === "UNKNOWN" ? undefined : { marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>Сеть {node.net === "UNKNOWN" && <span className="net-unknown-badge">не определена</span>}</strong>
          <div className="ltrow">
            <select value={netEdit} onChange={(e) => setNetEdit(e.target.value as Network)}>
              {ALL_NETWORKS.filter((n) => n !== "UNKNOWN").map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button style={{ marginTop: 0, width: "auto", padding: "6px 12px" }}
              disabled={netEdit === node.net} onClick={() => onSetNet(node.id, netEdit)}>Применить</button>
          </div>
        </div>
      )}

      {isWallet && (
        <div className="labelbox">
          {node.entityName ? (
            <div className="labelbox-found">
              <span className="dk">Владелец</span>
              <span className="entity-name">{node.entityName}</span>
              <button className="link" onClick={fetchLabel} disabled={labelBusy} title="Обновить">↺</button>
            </div>
          ) : (
            <>
              <button onClick={fetchLabel} disabled={labelBusy}>
                {labelBusy ? "Загрузка…" : "Получить метку из эксплорера"}
              </button>
              {labelErr && <div className="muted">{labelErr}</div>}
            </>
          )}
        </div>
      )}

      {/* Case notes (Phase 4): timestamped investigator notes / suspect flags
          tied to this node — the raw material of the case narrative. */}
      <div className="annbox">
        <strong>Заметки</strong>
        {nodeAnnotations.length > 0 && (
          <ul className="annlist">
            {nodeAnnotations.slice().sort((a, b) => b.createdAt - a.createdAt).map((a) => (
              <li key={a.id} className={`annitem ${a.kind}`}>
                <span className="anngly">{a.kind === "suspect" ? "🚩" : "📝"}</span>
                <div className="anntext">
                  <div>{a.text}</div>
                  <div className="annmeta">{fmtDate(a.createdAt)}{a.nodeIds.length > 1 ? ` · ${a.nodeIds.length} узлов` : ""}</div>
                </div>
                <button className="link anndel" title="Удалить" onClick={() => onDeleteAnnotation(a.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="anninput"
          placeholder="заметка по узлу для отчёта…"
          rows={2}
          value={annText}
          onChange={(e) => setAnnText(e.target.value)}
        />
        <div className="annrow">
          <select value={annKind} onChange={(e) => setAnnKind(e.target.value as AnnotationKind)}>
            <option value="note">📝 заметка</option>
            <option value="suspect">🚩 подозрительно</option>
          </select>
          <button className="primary" onClick={addAnnotation} disabled={!annText.trim()}>Добавить</button>
        </div>
      </div>

      {isWallet && (
        <div className="tracebox">
          <strong>🔥 Проследить поток (follow the money)</strong>
          <div className="ltchecks">
            <label>направление
              <select value={traceDir} onChange={(e) => setTraceDir(e.target.value as "out" | "in")}>
                <option value="out">куда ушли (out)</option>
                <option value="in">откуда пришли (in)</option>
              </select>
            </label>
            <label className="lim">хопов <input type="number" min={1} max={5} value={traceHops}
              onChange={(e) => setTraceHops(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <label className="lim">мин $ <input type="number" min={0} value={traceMinUsd}
              onChange={(e) => setTraceMinUsd(Math.max(0, Number(e.target.value) || 0))} /></label>
          </div>
          {traceMsg && <div className="flash">{traceMsg}</div>}
          <button className="primary" onClick={runTrace} disabled={traceBusy}>
            {traceBusy ? "Трассировка…" : "Проследить поток"}
          </button>
          <p className="muted">Разворачивает цепочку переводов, прыгает через мосты и останавливается на биржах.</p>
        </div>
      )}

      <div className="delbox">
        {confirmDel ? (
          <div className="delconfirm">
            <span>Удалить узел и все его связи?</span>
            <button className="danger" onClick={() => onRemove(node.id)}>Удалить</button>
            <button onClick={() => setConfirmDel(false)}>Отмена</button>
          </div>
        ) : (
          <button className="danger" onClick={() => setConfirmDel(true)}>Удалить из графа</button>
        )}
      </div>
    </>
  );
}

// ── Транзакции tab — sortable/filterable, virtual-scrolled table for the net ──
// Native gas tokens (per supported chain) — used for the Нативные/Токены client
// filter over the fully-loaded history.
const NATIVE_ASSETS = new Set(["ETH", "BNB", "POL", "MATIC", "TRX", "SOL"]);
const isNativeAsset = (a?: string) => NATIVE_ASSETS.has((a ?? "").toUpperCase());

// Fixed transfer-row height (kept in sync with .transfer-table row CSS) so the
// virtual window can map scroll offset → row index.
const ROW_H = 30;

// Minimal windowed rendering: only the rows visible in the scroll container are
// mounted, with spacer rows padding the scroll height. Handles up to the full
// 2000-row history without paging or thousands of DOM nodes.
function useVirtualRows(total: number, fallbackH: number = ROW_H, overscan = 8) {
  const ref = useRef<HTMLDivElement>(null);
  // Real rendered row height (decoupled from the CSS value): measured from a live
  // row, so changing the row height/font in CSS doesn't desync the scroll math.
  const [rowH, setRowH] = useState(fallbackH);
  const [range, setRange] = useState({ start: 0, end: Math.min(total, 40) });
  const measure = useCallback(() => {
    const sample = ref.current?.querySelector("tbody tr:not([aria-hidden])") as HTMLElement | null;
    if (sample && sample.offsetHeight > 0) setRowH((prev) => (Math.abs(sample.offsetHeight - prev) > 0.5 ? sample.offsetHeight : prev));
  }, []);
  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / rowH) - overscan);
    const visible = Math.ceil(el.clientHeight / rowH) + overscan * 2;
    setRange({ start, end: Math.min(total, start + visible) });
  }, [total, rowH, overscan]);
  // Measure + recompute on mount AND whenever the container resizes (viewport /
  // panel / header height changes don't fire scroll). Scrolling only recomputes,
  // to avoid a layout read per wheel tick.
  useEffect(() => {
    measure(); recompute();
    const el = ref.current;
    const onResize = () => { measure(); recompute(); };
    window.addEventListener("resize", onResize);
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    }
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); };
  }, [measure, recompute]);
  return {
    ref, start: range.start, end: range.end, onScroll: recompute,
    padTop: range.start * rowH, padBottom: Math.max(0, (total - range.end) * rowH),
  };
}

// Transactions folded into an aggregated Tx node — listed like a node's tx tab,
// but read straight from the node's `members` (no loading, already in memory).
function AggTxTab({ node }: { node: GNode }) {
  const members = useMemo(
    () => (node.members ?? []).slice().sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
    [node.members],
  );
  const v = useVirtualRows(members.length);
  const window = members.slice(v.start, v.end);
  return (
    <div className="tx-tab">
      <div className="picker-header">
        <span>{members.length} свёрнутых переводов{node.amount != null ? ` · Σ ${fmtAmt(node.amount)} ${node.coin ?? ""}` : ""}</span>
      </div>
      <div className="transfer-picker-wrap wide" ref={v.ref} onScroll={v.onScroll}>
        <table className="transfer-table">
          <thead>
            <tr><th>Дата</th><th className="num">Сумма</th><th>Хеш</th></tr>
          </thead>
          <tbody>
            {v.padTop > 0 && <tr style={{ height: v.padTop }} aria-hidden />}
            {window.map((m, i) => (
              <tr key={v.start + i} title={`источник: ${m.source ?? "—"}\nзагружено: ${m.fetchedAt ? fmtDate(m.fetchedAt) : "—"}`}>
                <td className="tdate">{fmtDate(m.timestamp)}</td>
                <td className="num tamt">{fmtAmt(m.amount)} {m.coin ?? ""}</td>
                <td>
                  <span className="mono">{m.hash ? `${m.hash.slice(0, 10)}…` : "—"}</span>
                  {m.explorerUrl && <a className="txlink" href={m.explorerUrl} target="_blank" rel="noopener" title="Открыть в эксплорере" onClick={(e) => e.stopPropagation()}>↗</a>}
                </td>
              </tr>
            ))}
            {v.padBottom > 0 && <tr style={{ height: v.padBottom }} aria-hidden />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TxTab({
  activeNet, onNet, txs, busy, err, diag, status, addr, onLoadWindow, onRefresh, onAddSelected, labelByAddr,
}: {
  activeNet: Network;
  onNet: (net: Network) => void;
  txs: Transfer[] | null; // full stored history (drives the default view + metrics)
  busy: boolean;
  err: string | null;
  diag: string | null;
  status?: SourceStatus;
  addr?: string;
  onLoadWindow: (from?: number, to?: number) => Promise<{ transfers: Transfer[]; diag: string | null }>;
  onRefresh: () => void;
  onAddSelected: (sel: Transfer[]) => void;
  labelByAddr: Map<string, string>;
}) {
  const [native, setNative] = useState(true);
  const [token, setToken] = useState(true);

  const [sortKey, setSortKey] = useState<"date" | "usd">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [asset, setAsset] = useState("");
  const [dir, setDir] = useState<"" | "in" | "out">("");
  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd (inclusive)
  const [dateTo, setDateTo] = useState("");     // yyyy-mm-dd (inclusive)
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Labels fetched on demand for counterparties on the visible page that weren't
  // enriched at fetch time and aren't labelled graph nodes.
  const [fetched, setFetched] = useState<Map<string, string>>(() => new Map());
  const attempted = useRef<Set<string>>(new Set());

  // A date range triggers a server-side LOAD of that period (sliced over the
  // wallet's full stored history), kept separate from `txs` so the metrics/Связи
  // keep reflecting the full history.
  const [windowed, setWindowed] = useState<Transfer[] | null>(null);
  const [winBusy, setWinBusy] = useState(false);
  const [winDiag, setWinDiag] = useState<string | null>(null);

  const hasRange = !!(dateFrom || dateTo);
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;

  // Debounced period load. Fires whenever the range (or network) changes; clears
  // back to the full view when the range is emptied.
  useEffect(() => {
    if (!hasRange) { setWindowed(null); setWinDiag(null); setWinBusy(false); return; }
    let cancelled = false;
    setWinBusy(true); setWinDiag(null);
    const h = setTimeout(async () => {
      try {
        const { transfers, diag } = await onLoadWindow(fromMs, toMs);
        if (cancelled) return;
        setWindowed(transfers);
        setWinDiag(transfers.length ? null : (diag ?? "За выбранный период транзакций не найдено."));
      } catch (e: any) {
        if (!cancelled) { setWindowed([]); setWinDiag(e.message ?? "Ошибка загрузки за период"); }
      } finally {
        if (!cancelled) setWinBusy(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(h); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, activeNet]);

  // Rows in view: the loaded period when a range is set, else the full history.
  const source = hasRange ? (windowed ?? []) : (txs ?? []);
  const loading = busy || winBusy;

  const assets = useMemo(() => [...new Set(source.map((t) => t.asset).filter(Boolean))] as string[], [source]);
  useEffect(() => { setSel(new Set()); }, [source]);

  const filtered = useMemo(() => {
    let list = source.map((t, i) => ({ t, i }));
    if (!(native && token)) list = list.filter((x) => {
      const n = isNativeAsset(x.t.asset);
      if (native) return n;
      if (token) return !n;
      return false; // both unchecked → nothing
    });
    if (asset) list = list.filter((x) => x.t.asset === asset);
    if (dir && addr) list = list.filter((x) =>
      dir === "out" ? x.t.from?.toLowerCase() === addr : x.t.to?.toLowerCase() === addr);
    list.sort((a, b) => {
      const va = sortKey === "date" ? (a.t.timestamp ?? 0) : (a.t.usdValue ?? 0);
      const vb = sortKey === "date" ? (b.t.timestamp ?? 0) : (b.t.usdValue ?? 0);
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return list;
  }, [source, native, token, asset, dir, addr, sortKey, sortDir]);

  // Virtual scroll: render only the rows visible in the scroll container, so the
  // full (up to 2000-row) history scrolls smoothly without paging.
  const v = useVirtualRows(filtered.length);
  const windowRows = filtered.slice(v.start, v.end);

  // On-demand label lookup: fetch tags for the visible rows' counterparties that
  // have no label yet (not enriched, not a labelled graph node, not already tried).
  // Bounded concurrency; each address is attempted at most once per network.
  useEffect(() => {
    if (!addr) return;
    const need: string[] = [];
    for (const { t } of windowRows) {
      const out: boolean = t.from?.toLowerCase() === addr;
      const cp: string | undefined = (out ? t.to : t.from)?.toLowerCase();
      if (!cp || cp === addr) continue;
      const known = (out ? t.toLabel : t.fromLabel) || labelByAddr.get(cp) || fetched.get(cp);
      const key = `${activeNet}:${cp}`;
      if (!known && !attempted.current.has(key) && !need.includes(cp)) need.push(cp);
    }
    if (!need.length) return;
    let cancelled = false;
    (async () => {
      const CONC = 3;
      for (let i = 0; i < need.length && !cancelled; i += CONC) {
        const results = await Promise.all(need.slice(i, i + CONC).map(async (cp) => {
          attempted.current.add(`${activeNet}:${cp}`);
          try { const { label } = await store.addressLabel(activeNet, cp); return [cp, label] as const; }
          catch { return [cp, null] as const; }
        }));
        if (cancelled) break;
        const gained = results.filter(([, l]) => !!l) as [string, string][];
        // One state update per batch (not per address) → fewer re-renders.
        if (gained.length) setFetched((m) => { const n = new Map(m); for (const [cp, l] of gained) n.set(cp, l); return n; });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, v.start, v.end, activeNet, addr]);

  function sortBy(k: "date" | "usd") {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  }
  function toggle(i: number) {
    setSel((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }
  const selTransfers = () => source.filter((_, i) => sel.has(i));

  return (
    <div className="tx-tab">
      <div className="loadtx" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
        <div className="ltrow">
          <label>Сеть</label>
          <select value={activeNet} onChange={(e) => onNet(e.target.value as Network)}>
            {ALL_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="link tx-refresh" title="Обновить данные из эксплорера" onClick={onRefresh} disabled={busy}>↻</button>
        </div>
        <div className="ltchecks">
          <label><input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> Нативные</label>
          <label><input type="checkbox" checked={token} onChange={(e) => setToken(e.target.checked)} /> Токены</label>
        </div>
        <div className="tx-daterow">
          <span className="tx-date-lbl">период:</span>
          <label>с <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>по <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          {hasRange && (
            <button className="link tx-date-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>сбросить</button>
          )}
        </div>
        {loading && <div className="ai-thinking">{winBusy ? "Загрузка за период…" : "Загрузка транзакций…"}</div>}
        {!loading && err && <div className="error">{err}</div>}
        {/* Distinguish a source problem from a genuinely empty wallet: a down
            source is transient (retry), a drifted parser needs a code fix. */}
        {!loading && (status === "down" || status === "drift") && (
          <div className={`flash source-issue ${status}`}>
            <b>{status === "drift" ? "Источник изменил разметку" : "Источник недоступен"}</b>
            {" — "}
            {status === "drift"
              ? "скрейпер устарел, данные могут быть неполными (нужно обновить парсер)."
              : "не удалось получить данные. Нажмите ↻, чтобы повторить."}
            {diag && <div className="source-issue-detail">{diag}</div>}
          </div>
        )}
        {!loading && !source.length && (winDiag || diag) && status !== "down" && status !== "drift" && <div className="flash">{winDiag ?? diag}</div>}
      </div>

      {source.length > 0 && (
        <>
          <div className="picker-header">
            <div className="tx-filters">
              <select value={dir} onChange={(e) => setDir(e.target.value as any)}>
                <option value="">все</option>
                <option value="in">входящие</option>
                <option value="out">исходящие</option>
              </select>
              <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                <option value="">все активы</option>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <span>{filtered.length} из {source.length}{hasRange ? " за период" : ""}{sel.size ? ` · выбрано ${sel.size}` : ""}</span>
          </div>

          <div className="transfer-picker-wrap wide" ref={v.ref} onScroll={v.onScroll}>
            <table className="transfer-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="sortable" onClick={() => sortBy("date")}>Дата{sortKey === "date" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</th>
                  <th>Тип</th><th>Контрагент</th>
                  <th className="num">Сумма</th>
                  <th className="num sortable" onClick={() => sortBy("usd")}>USD{sortKey === "usd" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</th>
                </tr>
              </thead>
              <tbody>
                {v.padTop > 0 && <tr style={{ height: v.padTop }} aria-hidden />}
                {windowRows.map(({ t, i }) => {
                  const out = addr ? t.from?.toLowerCase() === addr : false;
                  const cpAddr = out ? t.to : t.from;
                  const cpLc = cpAddr?.toLowerCase();
                  const cpLabel = (out ? t.toLabel : t.fromLabel) ?? (cpLc ? labelByAddr.get(cpLc) ?? fetched.get(cpLc) : undefined);
                  // Provenance for this fact: where it came from + when we pulled it.
                  const txHref = t.hash ? txUrl(t.network as Network, t.hash) : null;
                  const prov = `источник: ${t.source ?? "—"}\nзагружено: ${t.fetchedAt ? fmtDate(t.fetchedAt) : "—"}`;
                  return (
                    <tr key={i} className={`${sel.has(i) ? "sel" : ""}${cpLabel ? " tagged" : ""}`} onClick={() => toggle(i)}>
                      <td><input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                      <td className="tdate" title={prov}>
                        {fmtDate(t.timestamp)}
                        {txHref && <a className="txlink" href={txHref} target="_blank" rel="noopener" title="Открыть в эксплорере" onClick={(e) => e.stopPropagation()}>↗</a>}
                      </td>
                      <td><span className={out ? "dir-out" : "dir-in"}>{out ? "→ out" : "← in"}</span></td>
                      <td>
                        <span className="taddr">
                          {cpLabel ? <span className="tagchip" title={`${cpLabel}\n${cpAddr ?? ""}`}>{cpLabel}</span> : null}
                          <span className="mono">{short(cpAddr)}</span>
                        </span>
                      </td>
                      <td className="num tamt">{fmtAmt(t.amount)} {t.asset ?? ""}</td>
                      <td className="num tusd">{fmtUsd(t.usdValue)}</td>
                    </tr>
                  );
                })}
                {v.padBottom > 0 && <tr style={{ height: v.padBottom }} aria-hidden />}
              </tbody>
            </table>
          </div>

          <button className="primary" disabled={!sel.size}
            onClick={() => { onAddSelected(selTransfers()); setSel(new Set()); }}>
            Добавить выбранные в граф ({sel.size})
          </button>
        </>
      )}
    </div>
  );
}

// ── Связи tab — counterparties aggregated from the active network's transfers ─
type Contact = { addr: string; label?: string | null; net?: string; inN: number; outN: number; usd: number };

function LinksTab({
  txs, addr, onAdd, onFocus, labelByAddr,
}: {
  txs: Transfer[] | null;
  addr?: string;
  onAdd: (sub: { nodes: GNode[]; edges: GEdge[] }) => void;
  onFocus: (id: string) => void;
  labelByAddr: Map<string, string>;
}) {
  const contacts = useMemo(() => {
    if (!txs || !addr) return [];
    const m = new Map<string, Contact>();
    for (const t of txs) {
      const out: boolean = t.from?.toLowerCase() === addr;
      const cp: string | undefined = (out ? t.to : t.from)?.toLowerCase();
      if (!cp || cp === addr) continue;
      const label = (out ? t.toLabel : t.fromLabel) ?? labelByAddr.get(cp);
      const c = m.get(cp) ?? { addr: cp, label, net: t.network, inN: 0, outN: 0, usd: 0 };
      if (out) c.outN++; else c.inN++;
      c.usd += t.usdValue ?? 0;
      if (!c.label && label) c.label = label;
      m.set(cp, c);
    }
    return [...m.values()].sort((a, b) => (b.inN + b.outN) - (a.inN + a.outN));
  }, [txs, addr]);

  if (!txs) return <p className="muted">Загрузите транзакции на вкладке «Транзакции», чтобы увидеть контрагентов.</p>;
  if (!contacts.length) return <p className="muted">Контрагенты не найдены в загруженных переводах.</p>;

  function addContact(c: Contact) {
    if (!txs || !addr) return;
    const rel = txs.filter((t) => t.from?.toLowerCase() === c.addr || t.to?.toLowerCase() === c.addr);
    onAdd(transfersSubgraph(rel));
  }

  return (
    <div className="links-tab">
      <p className="muted">{contacts.length} контрагентов из {txs.length} переводов</p>
      <ul className="contact-list">
        {contacts.map((c) => (
          <li key={c.addr}>
            <div className="contact-main">
              {c.label && <span className="tagchip" title={c.label}>{c.label}</span>}
              <span className="mono contact-addr">{short(c.addr)}</span>
            </div>
            <div className="contact-meta">
              {c.net && <span className="badge" style={{ background: networkColor(c.net as any) }}>{c.net}</span>}
              {c.inN > 0 && <span className="dir-in">← {c.inN}</span>}
              {c.outN > 0 && <span className="dir-out">→ {c.outN}</span>}
              {c.usd > 0 && <span className="tusd">{fmtUsd(c.usd)}</span>}
            </div>
            <div className="contact-actions">
              <button onClick={() => addContact(c)}>+ в граф</button>
              <button onClick={() => onFocus(walletNodeId((c.net ?? "UNKNOWN") as Network, c.addr))} title="Найти на графе">⌕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
