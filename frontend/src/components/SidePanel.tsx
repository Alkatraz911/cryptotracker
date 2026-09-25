import { tr, locale } from "../lib/i18n";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// AI chat is opened on demand — load it lazily so it isn't in the initial bundle.
const AiChat = lazy(() => import("./AiChat"));
import { store, type AiMsg, type NodeNetCache, type SourceStatus, type Transfer, type WalletBalance } from "../lib/store";
import { transfersSubgraph, bridgeSubgraph, annotationsForNodeView } from "../lib/graphMerge";
import { chainIdForNode, bridgeForTx, bridgeAnchorForTx } from "../lib/orbiter";
import { ALL_NETWORKS, networkColor, okxAddressUrl, txUrl, walletNodeId, type Network } from "../lib/explorers";
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

const na = () => tr("не определено");
const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "?");
const fmtDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleString(locale(), { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const fmtUsd = (v?: number) =>
  v == null ? "" : "$" + v.toLocaleString(locale(), { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 0 });
const fmtAmt = (v?: number) =>
  v == null ? "" : v.toLocaleString(locale(), { maximumFractionDigits: 4 });
const sumUsd = (ts: { usdValue?: number }[]) => ts.reduce((s, t) => s + (t.usdValue ?? 0), 0);

// Stamp the tags the list already shows onto a transfer row before it goes to the
// graph. The row itself may carry none (the backend caps enrichment per request),
// while the panel knows them from labelled graph nodes or its own on-demand
// lookups — without this the graph re-fetches every tag from scratch, and a
// rate-limited explorer (TronScan) answers some of those with nothing.
function withKnownLabels(t: Transfer, ...maps: Map<string, string>[]): Transfer {
  const tag = (a?: string | null) => {
    if (!a) return null;
    const k = a.toLowerCase();
    for (const m of maps) { const v = m.get(k); if (v) return v; }
    return null;
  };
  return { ...t, fromLabel: t.fromLabel ?? tag(t.from), toLabel: t.toLabel ?? tag(t.to) };
}

// Headline balance value: total USD across all holdings, else the largest
// holding's amount, else tr("не определено").
function balanceValue(bal?: WalletBalance | null): string {
  if (!bal || !bal.holdings.length) return na();
  if (bal.totalUsd != null) return fmtUsd(bal.totalUsd);
  const top = bal.holdings[0];
  return `${fmtAmt(top.amount)} ${top.asset}`;
}
// Tooltip: per-asset breakdown.
function balanceTitle(bal?: WalletBalance | null): string {
  if (!bal || !bal.holdings.length) return tr("Ончейн-баланс выбранной сети (нативный токен + токены)");
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
      const d = transfers.length ? undefined : (diag ? tr("Эксплорер: {diag}", { diag: tr(diag) }) : tr("Транзакций не найдено для этого адреса."));
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
        {risky && <span className="risk-pill">{tr("⚠ риск")}</span>}
        <button className="x sp-x" onClick={onClose} title={tr("Закрыть")}>×</button>
      </div>

      <div className="sp-title">
        {node.entityName && <div className="sp-entity">{node.entityName}</div>}
        <div className="sp-addr">
          <code className="mono">{node.address ?? node.hash ?? node.ip ?? node.uid ?? short(node.id)}</code>
          {(node.address || node.hash) && (
            <button className="sp-copy" title={tr("Скопировать")}
              onClick={() => navigator.clipboard?.writeText(node.address ?? node.hash ?? "")}>⧉</button>
          )}
          {node.explorerUrl && (
            <a className="sp-ext" href={node.explorerUrl} target="_blank" rel="noopener" title={tr("Открыть в эксплорере")}>↗</a>
          )}
        </div>
      </div>

      <div className="sp-metrics">
        {isWallet ? (
          <>
            <Metric label={tr("Отправлено")} loading={txLoading}
              value={txs ? String(sent.length) : na()} sub={txs && sentUsd > 0 ? fmtUsd(sentUsd) : undefined} />
            <Metric label={tr("Получено")} loading={txLoading}
              value={txs ? String(recv.length) : na()} sub={txs && recvUsd > 0 ? fmtUsd(recvUsd) : undefined} />
            <Metric label={tr("Баланс")} loading={balLoading}
              value={balanceValue(curBal?.bal)}
              sub={curBal?.bal && curBal.bal.holdings.length ? tr("{n} актива", { n: curBal.bal.holdings.length }) : undefined}
              title={balanceTitle(curBal?.bal)} />
          </>
        ) : isAgg ? (
          <>
            <Metric label={tr("Сумма")} value={node.amount != null ? `${fmtAmt(node.amount)} ${node.coin ?? ""}` : tr("{n} перев.", { n: node.members?.length ?? 0 })} />
            <Metric label={tr("Переводов")} value={String(node.members?.length ?? 0)} />
            <Metric label={tr("Период")} value={node.tsFrom ? `${fmtDate(node.tsFrom)} — ${fmtDate(node.tsTo)}` : na()} />
            <Metric label={tr("Сеть")} value={node.net && node.net !== "UNKNOWN" ? node.net : na()} />
          </>
        ) : isTx ? (
          <>
            <Metric label={tr("Сумма")} value={node.amount != null ? fmtAmt(node.amount) : na()} />
            <Metric label={tr("Актив")} value={node.coin ?? na()} />
            <Metric label={tr("Дата")} loading={dateBusy} value={node.timestamp ? fmtDate(node.timestamp) : na()}
              sub={node.source ?? undefined} title={node.fetchedAt ? tr("загружено: {when}", { when: fmtDate(node.fetchedAt) }) : undefined} />
            <Metric label={tr("Сеть")} value={node.chainName ?? (node.net && node.net !== "UNKNOWN" ? node.net : na())} />
          </>
        ) : (
          <>
            <Metric label={tr("Тип")} value={node.kind} />
            <Metric label={tr("Связи")} value={String(node.degree)} />
          </>
        )}
      </div>

      <div className="sp-tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{tr("Обзор")}</button>
        {isWallet && <button className={tab === "txs" ? "active" : ""} onClick={() => setTab("txs")}>{tr("Транзакции")}{txs ? ` (${txs.length})` : ""}</button>}
        {isAgg && <button className={tab === "txs" ? "active" : ""} onClick={() => setTab("txs")}>{tr("Транзакции (")}{node.members?.length ?? 0})</button>}
        {isWallet && <button className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}>{tr("Связи")}</button>}
        <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>{tr("ИИ-чат")}{chat.length ? ` (${chat.filter((m) => m.role === "user").length || "•"})` : ""}</button>
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
          <Suspense fallback={<div className="ai-thinking">{tr("Загрузка ИИ-чата…")}</div>}>
            <AiChat key={node.id} graph={graph} focusId={node.id} messages={chat} onMessagesChange={onChatChange} />
          </Suspense>
        )}
      </div>

      {tab === "overview" && (
        <div className="sp-foot">
          <button onClick={() => setTab("ai")}>{tr("Спросить ИИ об этом узле")}</button>
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value, sub, loading, title }: { label: string; value: string; sub?: string; loading?: boolean; title?: string }) {
  const isNa = value === na();
  return (
    <div className="sp-metric" title={title}>
      {loading
        ? <span className="sp-mv loading">{tr("Загрузка…")}</span>
        : <span className={`sp-mv${isNa ? " na" : ""}`} title={value}>{value}</span>}
      {sub && !loading && <span className="sp-msub">{sub}</span>}
      <span className="sp-ml">{label}</span>
    </div>
  );
}

// ── Overview tab — node actions (no details card, no category dropdown) ──────
type OverviewProps = Props & { isWallet: boolean; isTx: boolean };

function OverviewTab({
  node, graph, onAdd, onRemove, onSaveAnnotation, onDeleteAnnotation, onLabel, onSetNet, onUnmerge,
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
  const [labelEdit, setLabelEdit] = useState(false);
  const [credsCopied, setCredsCopied] = useState(false);
  const [labelText, setLabelText] = useState("");
  const [netEdit, setNetEdit] = useState<Network>(node.net && node.net !== "UNKNOWN" ? node.net : "ETH");

  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeMsg, setBridgeMsg] = useState<string | null>(null);


  useEffect(() => { setConfirmDel(false); setAnnText(""); setAnnKind("note"); setLabelEdit(false); setLabelText(""); setLabelErr(null); }, [node.id]);

  async function fetchLabel() {
    if (!node.address || !node.net || node.net === "UNKNOWN") return;
    setLabelBusy(true); setLabelErr(null);
    try {
      const { label, bridge } = await store.addressLabel(node.net, node.address);
      if (label) onLabel(node.id, label, bridge);
      else setLabelErr(tr("Метка не найдена для этого адреса."));
    } catch (e: any) { setLabelErr(e.message ?? tr("Ошибка запроса")); }
    finally { setLabelBusy(false); }
  }

  // Save a label the investigator typed or copied from OKX into the shared
  // registry — from then on it's applied automatically for everyone.
  async function saveLabel() {
    const label = labelText.trim();
    if (!node.address || !label) return;
    setLabelBusy(true); setLabelErr(null);
    try {
      await store.setLabel({ address: node.address, label, source: "okx" });
      onLabel(node.id, label);
      setLabelEdit(false); setLabelText("");
    } catch (e: any) { setLabelErr(e.message ?? tr("Не удалось сохранить метку")); }
    finally { setLabelBusy(false); }
  }

  // The userscript asks for the API origin and a token once — hand both over
  // as "api<TAB>token" so the user can paste them straight into its prompts.
  async function copyScriptCreds() {
    const { api, token } = store.scriptCreds();
    try { await navigator.clipboard.writeText(`${api}\n${token ?? ""}`); setCredsCopied(true); setTimeout(() => setCredsCopied(false), 2500); }
    catch { window.prompt(tr("Скопируйте (адрес API и токен):"), `${api}\n${token ?? ""}`); }
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
          ? tr("{chain} (получено)", { chain: hop.targetChainName })
          : tr("{chain} (отправлено)", { chain: hop.sourceChainName });
        const amt = hop.symbol ? `${hop.amount} ${hop.symbol}` : tr("перевод");
        setBridgeMsg(tr("Найден мост: {amount} ↔ {other}. Узел добавлен в граф.", { amount: amt, other }));
      } else setBridgeMsg(diag ?? tr("Кроссчейн-перевод не найден."));
    } catch (e: any) { setBridgeMsg(e.message ?? tr("Ошибка запроса к мосту")); }
    finally { setBridgeBusy(false); }
  }

  return (
    <>
      {isEntity && (
        <div className="entitybox" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>{tr("Объединённая сущность · {n} узлов", { n: node.mergedFrom!.length })}</strong>
          <ul className="aliaslist">
            {node.mergedFrom!.map((m) => (
              <li key={m.id}>
                <span className="ak">{m.kind}</span>
                <span className="av mono">{m.address ?? m.uid ?? m.ip ?? m.hash ?? m.label.replace("\n", " ")}</span>
                {m.net && m.net !== "UNKNOWN" && <span className="an">{m.net}</span>}
              </li>
            ))}
          </ul>
          <button onClick={() => onUnmerge(node.id)}>{tr("Разъединить")}</button>
        </div>
      )}

      {canResolve && (
        <div className="bridgebox" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>{tr("Кроссчейн-мост")}{resolver ? ` (${bridgeName})` : ""}</strong>
          <p className="muted">
            {resolver
              ? tr("Транзакция ведёт к мосту {bridge}. Найти её продолжение в сети назначения.", { bridge: bridgeName })
              : tr("Проверить кроссчейн-продолжение через Orbiter, deBridge, Across и LI.FI.")}
          </p>
          <button className="primary" onClick={resolveBridge} disabled={bridgeBusy}>
            {bridgeBusy ? tr("Поиск…") : tr("Найти кроссчейн-продолжение")}
          </button>
          {bridgeMsg && <div className="flash">{bridgeMsg}</div>}
        </div>
      )}

      {isWallet && (
        <div className={`netbox${node.net === "UNKNOWN" ? " netbox-warn" : ""}`} style={node.net === "UNKNOWN" ? undefined : { marginTop: 0, borderTop: "none", paddingTop: 0 }}>
          <strong>{tr("Сеть")} {node.net === "UNKNOWN" && <span className="net-unknown-badge">{tr("не определена")}</span>}</strong>
          <div className="ltrow">
            <select value={netEdit} onChange={(e) => setNetEdit(e.target.value as Network)}>
              {ALL_NETWORKS.filter((n) => n !== "UNKNOWN").map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button style={{ marginTop: 0, width: "auto", padding: "6px 12px" }}
              disabled={netEdit === node.net} onClick={() => onSetNet(node.id, netEdit)}>{tr("Применить")}</button>
          </div>
        </div>
      )}

      {isWallet && (
        <div className="labelbox">
          {node.entityName && !labelEdit ? (
            <div className="labelbox-found">
              <span className="dk">{tr("Владелец")}</span>
              <span className="entity-name">{node.entityName}</span>
              <button className="link" onClick={fetchLabel} disabled={labelBusy} title={tr("Обновить")}>↺</button>
              <button className="link" onClick={() => { setLabelText(node.entityName ?? ""); setLabelEdit(true); }} title={tr("Исправить метку")}>✎</button>
            </div>
          ) : labelEdit ? (
            <form className="labeledit" onSubmit={(e) => { e.preventDefault(); void saveLabel(); }}>
              <input autoFocus value={labelText} onChange={(e) => setLabelText(e.target.value)} maxLength={120}
                placeholder={tr("Метка (например, FixedFloat. User)")} />
              <div className="labeledit-actions">
                <button type="submit" className="primary" disabled={!labelText.trim() || labelBusy}>{labelBusy ? "…" : tr("Сохранить в реестр")}</button>
                <button type="button" onClick={() => setLabelEdit(false)}>{tr("Отмена")}</button>
              </div>
              {node.net && node.net !== "UNKNOWN" && (
                <p className="muted">
                  {tr("Метку можно взять в")} <a href={okxAddressUrl(node.net, node.address!) ?? "#"} target="_blank" rel="noreferrer">OKX Explorer ↗</a> {tr("— скопируйте её сюда, и она будет подтягиваться автоматически во всех делах.")}
                  {" "}{tr("Или поставьте")} <a href="/okx-labels.user.js" target="_blank" rel="noreferrer">{tr("скрипт для браузера")}</a> {tr("(Tampermonkey): он сам соберёт теги со страниц OKX.")}{" "}
                  <button type="button" className="link inline" onClick={copyScriptCreds}>{credsCopied ? tr("скопировано ✓") : tr("скопировать токен для скрипта")}</button>
                </p>
              )}
              {labelErr && <div className="muted">{labelErr}</div>}
            </form>
          ) : (
            <>
              <div className="labelbox-actions">
                <button onClick={fetchLabel} disabled={labelBusy}>
                  {labelBusy ? tr("Загрузка…") : tr("Получить метку из эксплорера")}
                </button>
                <button onClick={() => setLabelEdit(true)} title={tr("Ввести метку вручную или из OKX Explorer")}>✎</button>
              </div>
              {labelErr && <div className="muted">{labelErr}</div>}
            </>
          )}
        </div>
      )}

      {/* Case notes (Phase 4): timestamped investigator notes / suspect flags
          tied to this node — the raw material of the case narrative. */}
      <div className="annbox">
        <strong>{tr("Заметки")}</strong>
        {nodeAnnotations.length > 0 && (
          <ul className="annlist">
            {nodeAnnotations.slice().sort((a, b) => b.createdAt - a.createdAt).map((a) => (
              <li key={a.id} className={`annitem ${a.kind}`}>
                <span className="anngly">{a.kind === "suspect" ? "🚩" : "📝"}</span>
                <div className="anntext">
                  <div>{a.text}</div>
                  <div className="annmeta">{fmtDate(a.createdAt)}{a.nodeIds.length > 1 ? ` · ${tr("{n} узлов", { n: a.nodeIds.length })}` : ""}</div>
                </div>
                <button className="link anndel" title={tr("Удалить")} onClick={() => onDeleteAnnotation(a.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="anninput"
          placeholder={tr("заметка по узлу для отчёта…")}
          rows={2}
          value={annText}
          onChange={(e) => setAnnText(e.target.value)}
        />
        <div className="annrow">
          <select value={annKind} onChange={(e) => setAnnKind(e.target.value as AnnotationKind)}>
            <option value="note">{tr("📝 заметка")}</option>
            <option value="suspect">{tr("🚩 подозрительно")}</option>
          </select>
          <button className="primary" onClick={addAnnotation} disabled={!annText.trim()}>{tr("Добавить")}</button>
        </div>
      </div>

      <div className="delbox">
        {confirmDel ? (
          <div className="delconfirm">
            <span>{tr("Удалить узел и все его связи?")}</span>
            <button className="danger" onClick={() => onRemove(node.id)}>{tr("Удалить")}</button>
            <button onClick={() => setConfirmDel(false)}>{tr("Отмена")}</button>
          </div>
        ) : (
          <button className="ghost-danger" onClick={() => setConfirmDel(true)}>{tr("Удалить из графа")}</button>
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
        <span>{members.length} {tr("свёрнутых переводов")}{node.amount != null ? ` · Σ ${fmtAmt(node.amount)} ${node.coin ?? ""}` : ""}</span>
      </div>
      <div className="transfer-picker-wrap wide" ref={v.ref} onScroll={v.onScroll}>
        <table className="transfer-table">
          <thead>
            <tr><th>{tr("Дата")}</th><th className="num">{tr("Сумма")}</th><th>{tr("Хеш")}</th></tr>
          </thead>
          <tbody>
            {v.padTop > 0 && <tr style={{ height: v.padTop }} aria-hidden />}
            {window.map((m, i) => (
              <tr key={v.start + i} title={tr("источник: {source}\nзагружено: {when}", { source: m.source ?? "—", when: m.fetchedAt ? fmtDate(m.fetchedAt) : "—" })}>
                <td className="tdate">{fmtDate(m.timestamp)}</td>
                <td className="num tamt">{fmtAmt(m.amount)} {m.coin ?? ""}</td>
                <td>
                  <span className="mono">{m.hash ? `${m.hash.slice(0, 10)}…` : "—"}</span>
                  {m.explorerUrl && <a className="txlink" href={m.explorerUrl} target="_blank" rel="noopener" title={tr("Открыть в эксплорере")} onClick={(e) => e.stopPropagation()}>↗</a>}
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
        setWinDiag(transfers.length ? null : (diag ?? tr("За выбранный период транзакций не найдено.")));
      } catch (e: any) {
        if (!cancelled) { setWindowed([]); setWinDiag(e.message ?? tr("Ошибка загрузки за период")); }
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
  const selTransfers = () => source.filter((_, i) => sel.has(i)).map((t) => withKnownLabels(t, labelByAddr, fetched));

  return (
    <div className="tx-tab">
      <div className="loadtx" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
        <div className="ltrow">
          <label>{tr("Сеть")}</label>
          <select value={activeNet} onChange={(e) => onNet(e.target.value as Network)}>
            {ALL_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="link tx-refresh" title={tr("Обновить данные из эксплорера")} onClick={onRefresh} disabled={busy}>↻</button>
        </div>
        <div className="ltchecks">
          <label><input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> {tr("Нативные")}</label>
          <label><input type="checkbox" checked={token} onChange={(e) => setToken(e.target.checked)} /> {tr("Токены")}</label>
        </div>
        <div className="tx-daterow">
          <span className="tx-date-lbl">{tr("период:")}</span>
          <label>{tr("с")} <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>{tr("по")} <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          {hasRange && (
            <button className="link tx-date-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>{tr("сбросить")}</button>
          )}
        </div>
        {loading && <div className="ai-thinking">{winBusy ? tr("Загрузка за период…") : tr("Загрузка транзакций…")}</div>}
        {!loading && err && <div className="error">{err}</div>}
        {/* Distinguish a source problem from a genuinely empty wallet: a down
            source is transient (retry), a drifted parser needs a code fix. */}
        {!loading && (status === "down" || status === "drift") && (
          <div className={`flash source-issue ${status}`}>
            <b>{status === "drift" ? tr("Источник изменил разметку") : tr("Источник недоступен")}</b>
            {" — "}
            {status === "drift"
              ? tr("скрейпер устарел, данные могут быть неполными (нужно обновить парсер).")
              : tr("не удалось получить данные. Нажмите ↻, чтобы повторить.")}
            {diag && <div className="source-issue-detail">{tr(diag)}</div>}
          </div>
        )}
        {!loading && !source.length && (winDiag || diag) && status !== "down" && status !== "drift" && <div className="flash">{winDiag ?? diag}</div>}
      </div>

      {source.length > 0 && (
        <>
          <div className="picker-header">
            <div className="tx-filters">
              <select value={dir} onChange={(e) => setDir(e.target.value as any)}>
                <option value="">{tr("все")}</option>
                <option value="in">{tr("входящие")}</option>
                <option value="out">{tr("исходящие")}</option>
              </select>
              <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                <option value="">{tr("все активы")}</option>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <span>{filtered.length} {tr("из")} {source.length}{hasRange ? tr(" за период") : ""}{sel.size ? ` · ${tr("выбрано {n}", { n: sel.size })}` : ""}</span>
          </div>

          <div className="transfer-picker-wrap wide" ref={v.ref} onScroll={v.onScroll}>
            <table className="transfer-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="sortable" onClick={() => sortBy("date")}>{tr("Дата")}{sortKey === "date" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</th>
                  <th>{tr("Тип")}</th><th>{tr("Контрагент")}</th>
                  <th className="num">{tr("Сумма")}</th>
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
                  const prov = tr("источник: {source}\nзагружено: {when}", { source: t.source ?? "—", when: t.fetchedAt ? fmtDate(t.fetchedAt) : "—" });
                  return (
                    <tr key={i} className={`${sel.has(i) ? "sel" : ""}${cpLabel ? " tagged" : ""}`} onClick={() => toggle(i)}>
                      <td><input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                      <td className="tdate" title={prov}>
                        {fmtDate(t.timestamp)}
                        {txHref && <a className="txlink" href={txHref} target="_blank" rel="noopener" title={tr("Открыть в эксплорере")} onClick={(e) => e.stopPropagation()}>↗</a>}
                      </td>
                      <td><span className={out ? "dir-out" : "dir-in"}>{out ? "→ out" : "← in"}</span></td>
                      <td className="tcp">
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
            {tr("Добавить выбранные в граф (")}{sel.size})
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

  if (!txs) return <p className="muted">{tr("Загрузите транзакции на вкладке «Транзакции», чтобы увидеть контрагентов.")}</p>;
  if (!contacts.length) return <p className="muted">{tr("Контрагенты не найдены в загруженных переводах.")}</p>;

  function addContact(c: Contact) {
    if (!txs || !addr) return;
    const rel = txs.filter((t) => t.from?.toLowerCase() === c.addr || t.to?.toLowerCase() === c.addr);
    onAdd(transfersSubgraph(rel.map((t) => withKnownLabels(t, labelByAddr))));
  }

  return (
    <div className="links-tab">
      <p className="muted">{contacts.length} {tr("контрагентов из")} {txs.length} {tr("переводов")}</p>
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
              <button onClick={() => addContact(c)}>{tr("+ в граф")}</button>
              <button onClick={() => onFocus(walletNodeId((c.net ?? "UNKNOWN") as Network, c.addr))} title={tr("Найти на графе")}>⌕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
