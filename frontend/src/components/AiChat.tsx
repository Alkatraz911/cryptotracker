import { useEffect, useRef, useState } from "react";
import { store, type AiAnalysis, type AiMsg, type AiNodeLite } from "../lib/store";
import { neighborhoodSubgraph } from "../lib/graphMerge";
import type { BuiltGraph, GNode } from "../lib/graph";

interface Props {
  graph: BuiltGraph;
  focusId: string;
  messages: AiMsg[];
  onMessagesChange: (msgs: AiMsg[]) => void;
}

// Minimal, safe markdown rendering for the model's narrative.
function renderNarrative(md: string): string {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

const SEV_CLASS: Record<string, string> = { high: "sig-high", warn: "sig-warn", info: "sig-info" };

export default function AiChat({ graph, focusId, messages, onMessagesChange }: Props) {
  const focus: GNode | undefined = graph.nodes.find((n) => n.id === focusId);
  // Local source of truth for the conversation; synced up to the parent (App)
  // so it persists per node across tab/node switches and reloads.
  const [msgs, setMsgs] = useState<AiMsg[]>(messages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<AiAnalysis["used"]>(null);

  const [fbSent, setFbSent] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);

  const [kTitle, setKTitle] = useState("");
  const [kContent, setKContent] = useState("");
  const [kSaved, setKSaved] = useState(false);

  const runSeq = useRef(0);
  const started = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Push local conversation up for persistence whenever it changes.
  useEffect(() => { onMessagesChange(msgs); /* eslint-disable-next-line */ }, [msgs]);

  async function ask(question?: string) {
    if (!focus || busy) return;
    const q = (question ?? input).trim();
    if (q) setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput(""); setFbSent(null);
    const seq = ++runSeq.current;
    setBusy(true);
    try {
      const sub = neighborhoodSubgraph(graph, focusId, 2);
      const nodes: AiNodeLite[] = sub.nodes.map((n) => ({
        id: n.id, kind: n.kind, label: n.label,
        address: n.address, net: n.net, nets: n.nets,
        entityName: n.entityName, tag: n.tag, note: n.note,
        amount: n.amount, coin: n.coin, chainName: n.chainName,
      }));
      const edges = sub.edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
      const analysis = await store.aiAnalyze({ focusId, nodes, edges, question: q || undefined });
      if (seq !== runSeq.current) return;
      setMsgs((m) => [...m, {
        role: "assistant",
        text: analysis.narrative || analysis.diag || "Модель не вернула ответ.",
        signals: analysis.signals,
      }]);
      setUsed(analysis.used);
    } catch (e: any) {
      if (seq !== runSeq.current) return;
      setMsgs((m) => [...m, { role: "assistant", text: e.message ?? "Ошибка запроса к ИИ" }]);
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }

  // Auto-run an opening analysis only the first time this node's chat is opened
  // with no saved history (returning to an existing conversation shows it as-is).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (msgs.length === 0) ask();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function sendFeedback(rating: "up" | "down") {
    try {
      const r = await store.aiFeedback({
        rating,
        correction: rating === "down" ? correction.trim() || undefined : undefined,
        focusAddress: focus?.address ?? undefined,
        focusNetwork: focus?.net ?? undefined,
      });
      setFbSent(r.stored ? "Спасибо — учтём в следующих анализах." : "Спасибо за отзыв.");
      setShowCorrection(false); setCorrection("");
    } catch (e: any) {
      setFbSent(e.message ?? "Не удалось отправить отзыв");
    }
  }

  async function saveKnowledge() {
    if (!focus?.address || !kTitle.trim() || !kContent.trim()) return;
    try {
      await store.aiAddKnowledge({
        kind: "address", network: focus.net ?? undefined, address: focus.address,
        title: kTitle.trim(), content: kContent.trim(),
      });
      setKSaved(true);
      setTimeout(() => setKSaved(false), 2500);
      setKTitle(""); setKContent("");
    } catch { /* ignore */ }
  }

  const hasAssistant = msgs.some((m) => m.role === "assistant");

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-log" ref={logRef}>
        {focus && (
          <div className="ai-focus muted">
            Фокус: {focus.entityName ? `«${focus.entityName}» ` : ""}
            {focus.address ?? focus.label?.replace("\n", " ") ?? focus.id}
            {focus.net && focus.net !== "UNKNOWN" ? ` · ${focus.net}` : ""}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.role === "assistant" && m.signals && m.signals.length > 0 && (
              <div className="ai-signals">
                {m.signals.map((s) => (
                  <span key={s.id} className={`ai-sig ${SEV_CLASS[s.severity] ?? "sig-info"}`}>{s.label}</span>
                ))}
              </div>
            )}
            {m.role === "assistant"
              ? <div className="ai-bubble" dangerouslySetInnerHTML={{ __html: renderNarrative(m.text) }} />
              : <div className="ai-bubble">{m.text}</div>}
          </div>
        ))}
        {busy && <div className="ai-msg assistant"><div className="ai-bubble ai-thinking">Модель печатает…</div></div>}

        {hasAssistant && !busy && (
          <div className="ai-feedback">
            <span className="muted">Полезно?</span>
            <button className="link" onClick={() => sendFeedback("up")}>👍</button>
            <button className="link" onClick={() => setShowCorrection((v) => !v)}>👎</button>
            {fbSent && <span className="ai-fb-ok">{fbSent}</span>}
            {showCorrection && (
              <div className="ai-correction">
                <textarea placeholder="Что не так / как правильно? (станет подсказкой на будущее)"
                  value={correction} onChange={(e) => setCorrection(e.target.value)} />
                <button className="primary" onClick={() => sendFeedback("down")}>Отправить коррекцию</button>
              </div>
            )}
          </div>
        )}

        {focus?.address && hasAssistant && !busy && (
          <details className="ai-know">
            <summary>Запомнить этот адрес в базе знаний</summary>
            <input placeholder="Название (напр. «Депозит Binance»)" value={kTitle} onChange={(e) => setKTitle(e.target.value)} />
            <textarea placeholder="Что известно об адресе (роль, риск, источник)" value={kContent} onChange={(e) => setKContent(e.target.value)} />
            <button className="primary" onClick={saveKnowledge} disabled={!kTitle.trim() || !kContent.trim()}>
              {kSaved ? "Сохранено ✓" : "Сохранить"}
            </button>
          </details>
        )}

        {used && (
          <div className="ai-engine muted">
            движок: {used.provider} · {used.model} · знаний: {used.knowledge} · узлов: {used.nodes}
          </div>
        )}
      </div>

      <div className="ai-chat-input">
        <textarea
          placeholder="Спросите: «куда выводят средства?», «кто контрагенты?»…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <button className="primary" onClick={() => ask()} disabled={busy || !input.trim()}>Отправить</button>
      </div>
    </div>
  );
}
