import { useState } from "react";
import Modal from "./Modal";
import { store, type FeedbackKind } from "../lib/store";

interface Props {
  projectId: string | null;
  projectName: string;
  onClose: () => void;
}

const MIN_MESSAGE = 10;

// What we attach to every report so the reporter doesn't have to describe
// their setup — the same things we'd ask for first when triaging.
function collectContext(projectId: string | null, projectName: string): Record<string, unknown> {
  return {
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    language: navigator.language,
    theme: document.documentElement.dataset.theme ?? null,
    projectId, projectName: projectName || null,
    sentAt: new Date().toISOString(),
  };
}

export default function FeedbackModal({ projectId, projectName, onClose }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSend = title.trim().length >= 3 && message.trim().length >= MIN_MESSAGE && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true); setErr(null);
    try {
      await store.sendFeedback({
        kind, title: title.trim(), message: message.trim(),
        context: attach ? collectContext(projectId, projectName) : undefined,
      });
      setSent(true);
    } catch (ex: any) { setErr(ex.message ?? "Не удалось отправить"); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Modal title="Спасибо!" onClose={onClose} width={420}>
        <p className="fb-thanks">
          {kind === "bug" ? "Отчёт об ошибке получен" : "Предложение получено"} — мы посмотрим его в ближайшее время.
        </p>
        <div className="modalactions">
          <button type="button" className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Обратная связь" onClose={onClose} width={480}>
      <form onSubmit={submit} className="fb-form">
        <div className="fb-kind" role="radiogroup" aria-label="Тип обращения">
          <button type="button" className={kind === "bug" ? "active" : ""} onClick={() => setKind("bug")} aria-pressed={kind === "bug"}>
            🐞 Сообщить об ошибке
          </button>
          <button type="button" className={kind === "idea" ? "active" : ""} onClick={() => setKind("idea")} aria-pressed={kind === "idea"}>
            💡 Предложить улучшение
          </button>
        </div>

        <label>Кратко, в одну строку</label>
        <input
          autoFocus maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "bug" ? "Например: не подтягивается метка на Tron-адресе" : "Например: экспорт таблицы транзакций в CSV"}
        />

        <label>{kind === "bug" ? "Что произошло и как повторить" : "Что хотелось бы и зачем"}</label>
        <textarea
          rows={6} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === "bug"
            ? "Что делали → что ожидали → что увидели. Адрес/сеть/хэш, если дело в данных."
            : "Опишите сценарий: где в приложении это нужно и какую задачу решает."}
        />
        <div className="fb-counter">{message.trim().length < MIN_MESSAGE ? `ещё минимум ${MIN_MESSAGE - message.trim().length} симв.` : `${message.length} / 5000`}</div>

        <label className="fb-attach">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          приложить технические данные (страница, браузер, текущее дело)
        </label>

        {err && <div className="error">{err}</div>}
        <div className="modalactions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary" disabled={!canSend}>{busy ? "Отправка…" : "Отправить"}</button>
        </div>
      </form>
    </Modal>
  );
}
