import { tr } from "../lib/i18n";
import { useState } from "react";
import { store, type User } from "../lib/store";

// The sign-in screen opens with the thing this tool exists to produce: a traced
// path of money leaving a victim's wallet, passing a no-KYC exchanger and a
// bridge, and surfacing on an exchange. It draws once on load — the app's only
// unprompted motion — and then sits still.
function TraceFigure() {
  return (
    <figure className="auth-trace" aria-label={tr("След перевода: кошелёк → обменник → мост → биржа")}>
      <svg viewBox="0 0 440 300" role="img">
        <defs>
          <marker id="trace-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
          </marker>
        </defs>

        <path className="trace-path" style={{ ["--d" as string]: "0.1s" }} markerEnd="url(#trace-arrow)" d="M70 62 L134 98" />
        <path className="trace-path" style={{ ["--d" as string]: "0.45s" }} markerEnd="url(#trace-arrow)" d="M164 114 L230 127" />
        <path className="trace-path" style={{ ["--d" as string]: "0.75s" }} markerEnd="url(#trace-arrow)" d="M264 146 L322 192" />
        <path className="trace-path" style={{ ["--d" as string]: "1.05s" }} markerEnd="url(#trace-arrow)" d="M350 216 L386 243" />

        <g className="trace-stop" style={{ ["--d" as string]: "0s" }}>
          <circle cx="54" cy="52" r="16" className="ring tron" />
          <text x="54" y="22" className="lbl">{tr("Кошелёк жертвы")}</text>
        </g>
        <g className="trace-stop" style={{ ["--d" as string]: "0.4s" }}>
          <circle cx="149" cy="106" r="9" className="bead" />
          <text x="143" y="134" className="amt">4 685 USDT</text>
        </g>
        <g className="trace-stop" style={{ ["--d" as string]: "0.7s" }}>
          <circle cx="248" cy="132" r="16" className="ring tron flagged" />
          <text x="248" y="167" className="lbl">FixedFloat</text>
          <text x="248" y="183" className="sub">{tr("обменник без KYC")}</text>
        </g>
        <g className="trace-stop" style={{ ["--d" as string]: "1s" }}>
          <circle cx="336" cy="204" r="13" className="ring bridge" />
          <text x="316" y="210" className="lbl end">{tr("Мост в ETH")}</text>
        </g>
        <g className="trace-stop" style={{ ["--d" as string]: "1.3s" }}>
          <circle cx="402" cy="256" r="16" className="ring bsc" />
          <text x="398" y="290" className="lbl">{tr("Биржа")}</text>
        </g>
      </svg>
      <figcaption>{tr("Семь часов и три сети между кражей и точкой вывода.")}</figcaption>
    </figure>
  );
}

export default function Auth({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const u = mode === "login"
        ? await store.login(email, password)
        : await store.register(email, password);
      onAuthed(u);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authwrap">
      <div className="authgrid">
        <TraceFigure />

        <form className="authcard" onSubmit={submit}>
          <h1>CryptoTracker</h1>
          <p className="sub">
            {mode === "login"
              ? tr("Граф переводов, метки адресов и кроссчейн-мосты — в одном деле.")
              : tr("Новая учётная запись аналитика.")}
          </p>

          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="username" required />

          <label htmlFor="auth-pw">{tr("Пароль")}</label>
          <input id="auth-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6} required />

          {err && <div className="error">{err}</div>}

          <button className="primary" disabled={busy}>
            {busy ? tr("Проверяем…") : mode === "login" ? tr("Войти") : tr("Создать аккаунт")}
          </button>

          <button type="button" className="link"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}>
            {mode === "login" ? tr("Нет аккаунта? Зарегистрироваться") : tr("Уже есть аккаунт? Войти")}
          </button>
        </form>
      </div>
    </div>
  );
}
