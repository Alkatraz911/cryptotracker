import { tr } from "../lib/i18n";
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
    } catch (ex: any) { setErr(ex.message ?? tr("Не удалось отправить")); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Modal title={tr("Спасибо!")} onClose={onClose} width={420}>
        <p className="fb-thanks">
          {kind === "bug" ? tr("Отчёт об ошибке получен") : tr("Предложение получено")} {tr("— мы посмотрим его в ближайшее время.")}
        </p>
        <div className="modalactions">
          <button type="button" className="primary" onClick={onClose}>{tr("Закрыть")}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tr("Обратная связь")} onClose={onClose} width={480}>
      <form onSubmit={submit} className="fb-form">
        <div className="fb-kind" role="radiogroup" aria-label={tr("Тип обращения")}>
          <button type="button" className={kind === "bug" ? "active" : ""} onClick={() => setKind("bug")} aria-pressed={kind === "bug"}>
            {tr("🐞 Сообщить об ошибке")}
          </button>
          <button type="button" className={kind === "idea" ? "active" : ""} onClick={() => setKind("idea")} aria-pressed={kind === "idea"}>
            {tr("💡 Предложить улучшение")}
          </button>
        </div>

        <label>{tr("Кратко, в одну строку")}</label>
        <input
          autoFocus maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "bug" ? tr("Например: не подтягивается метка на Tron-адресе") : tr("Например: экспорт таблицы транзакций в CSV")}
        />

        <label>{kind === "bug" ? tr("Что произошло и как повторить") : tr("Что хотелось бы и зачем")}</label>
        <textarea
          rows={6} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === "bug"
            ? tr("Что делали → что ожидали → что увидели. Адрес/сеть/хэш, если дело в данных.")
            : tr("Опишите сценарий: где в приложении это нужно и какую задачу решает.")}
        />
        <div className="fb-counter">{message.trim().length < MIN_MESSAGE ? tr("ещё минимум {n} симв.", { n: MIN_MESSAGE - message.trim().length }) : `${message.length} / 5000`}</div>

        <label className="fb-attach">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          {tr("приложить технические данные (страница, браузер, текущее дело)")}
        </label>

        {err && <div className="error">{err}</div>}
        <div className="modalactions">
          <button type="button" onClick={onClose}>{tr("Отмена")}</button>
          <button type="submit" className="primary" disabled={!canSend}>{busy ? tr("Отправка…") : tr("Отправить")}</button>
        </div>
      </form>
    </Modal>
  );
}
