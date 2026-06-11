import { useState } from "react";
import { store, type User } from "../lib/store";

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
      <form className="authcard" onSubmit={submit}>
        <h1>CryptoTracker</h1>
        <p className="sub">{mode === "login" ? "Вход в личный кабинет" : "Регистрация"}</p>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" required />

        <label>Пароль</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={6} required />

        {err && <div className="error">{err}</div>}

        <button className="primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>

        <button type="button" className="link"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}>
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>
      </form>
    </div>
  );
}
