import { useEffect, useState } from "react";
import { store, type AdminUser, type Analytics, type BridgeAddress, type User } from "../lib/store";

type Tab = "analytics" | "users" | "bridges";

export default function AdminPage({ user, onClose }: { user: User; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("analytics");
  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <button className="admin-back" onClick={onClose}>← Назад</button>
        <h1>Администрирование</h1>
        <span className="admin-who">{user.email}</span>
      </header>
      <nav className="admin-tabs">
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}>Аналитика</button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Пользователи</button>
        <button className={tab === "bridges" ? "active" : ""} onClick={() => setTab("bridges")}>Мосты</button>
      </nav>
      <div className="admin-page-body">
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "users" && <UsersTab selfId={user.id} />}
        {tab === "bridges" && <BridgesTab />}
      </div>
    </div>
  );
}

// ── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    store.getAnalytics(days).then(setData).catch((e) => setErr(e.message));
  }, [days]);

  const maxCount = data ? Math.max(1, ...data.byModule.map((m) => m.count)) : 1;

  return (
    <div className="admin-section">
      <div className="admin-rangebar">
        <span className="muted">Период:</span>
        {[7, 30, 90].map((d) => (
          <button key={d} className={`admin-range${days === d ? " active" : ""}`} onClick={() => setDays(d)}>{d} дн.</button>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {!data ? <p className="muted">Загрузка…</p> : (
        <>
          <div className="admin-cards">
            <Card label="Событий" value={data.totalEvents.toLocaleString()} />
            <Card label="Активных пользователей" value={String(data.activeUsers)} />
            <Card label="Модулей" value={String(data.byModule.length)} />
          </div>

          <h3 className="admin-h3">Востребованность модулей</h3>
          {data.byModule.length === 0 ? <p className="muted">Нет данных за период.</p> : (
            <div className="usage-bars">
              {data.byModule.map((m) => (
                <div className="usage-bar" key={m.module}>
                  <span className="ub-label">{m.module}</span>
                  <span className="ub-track"><span className="ub-fill" style={{ width: `${(m.count / maxCount) * 100}%` }} /></span>
                  <span className="ub-count">{m.count.toLocaleString()}<i> · {m.users} польз.</i></span>
                </div>
              ))}
            </div>
          )}

          <h3 className="admin-h3">По пользователям</h3>
          <table className="admin-table">
            <thead><tr><th>Пользователь</th><th className="num">Событий</th><th>Активность</th><th>Топ-модули</th></tr></thead>
            <tbody>
              {data.byUser.map((u) => (
                <tr key={u.userId}>
                  <td>{u.email}{u.role === "admin" && <span className="role-pill">admin</span>}</td>
                  <td className="num">{u.events.toLocaleString()}</td>
                  <td className="tdate">{u.lastActive ? new Date(u.lastActive).toLocaleString() : "—"}</td>
                  <td className="muted">{u.modules.slice(0, 3).map((m) => `${m.module} (${m.count})`).join(", ")}</td>
                </tr>
              ))}
              {data.byUser.length === 0 && <tr><td colSpan={4} className="muted">Нет активности.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-card">
      <span className="admin-card-v">{value}</span>
      <span className="admin-card-l">{label}</span>
    </div>
  );
}

// ── Users (create / edit role / reset password / delete) ─────────────────────
function UsersTab({ selfId }: { selfId: string }) {
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");

  const load = () => store.listUsers().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); }
    catch (e: any) { setErr(e.message ?? "Ошибка"); }
    finally { setBusy(false); }
  }
  const create = () => {
    if (!email.trim() || password.length < 6) { setErr("Email и пароль (мин. 6) обязательны"); return; }
    run(() => store.createUser({ email: email.trim(), password, role }))
      .then(() => { setEmail(""); setPassword(""); setRole("user"); });
  };
  const changeRole = (u: AdminUser, r: "user" | "admin") => run(() => store.updateUser(u.id, { role: r }));
  const resetPw = (u: AdminUser) => {
    const pw = window.prompt(`Новый пароль для ${u.email} (мин. 6 символов):`);
    if (pw == null) return;
    if (pw.length < 6) { setErr("Пароль слишком короткий"); return; }
    run(() => store.updateUser(u.id, { password: pw }));
  };
  const del = (u: AdminUser) => {
    if (!window.confirm(`Удалить пользователя ${u.email}? Его проекты будут удалены.`)) return;
    run(() => store.deleteUser(u.id));
  };

  return (
    <div className="admin-section">
      <div className="admin-form">
        <input placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="пароль (мин. 6)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as any)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button className="primary" onClick={create} disabled={busy}>Создать</button>
      </div>
      {err && <div className="error">{err}</div>}
      {rows == null ? <p className="muted">Загрузка…</p> : (
        <table className="admin-table">
          <thead><tr><th>Email</th><th>Роль</th><th>Создан</th><th>Действия</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === selfId && <span className="role-pill">вы</span>}</td>
                <td>
                  <select value={u.role} disabled={busy || u.id === selfId} onChange={(e) => changeRole(u, e.target.value as any)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="tdate">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="admin-actions">
                  <button onClick={() => resetPw(u)} disabled={busy}>Сбросить пароль</button>
                  {u.id !== selfId && <button className="danger" onClick={() => del(u)} disabled={busy}>Удалить</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Bridges ──────────────────────────────────────────────────────────────────
function BridgesTab() {
  const [rows, setRows] = useState<BridgeAddress[] | null>(null);
  const [resolvers, setResolvers] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [bridge, setBridge] = useState("orbiter");
  const [name, setName] = useState("");

  const load = () => store.listBridges().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); store.bridgeResolvers().then(setResolvers).catch(() => {}); }, []);

  async function add() {
    if (!address.trim() || !name.trim()) return;
    setBusy(true); setErr(null);
    try { await store.addBridge({ address: address.trim(), bridge, name: name.trim() }); setAddress(""); setName(""); await load(); }
    catch (e: any) { setErr(e.message ?? "Ошибка"); }
    finally { setBusy(false); }
  }
  async function remove(addr: string) {
    setErr(null);
    try { await store.removeBridge(addr); await load(); } catch (e: any) { setErr(e.message ?? "Ошибка"); }
  }

  const resolverIds = resolvers.map((r) => r.id);
  return (
    <div className="admin-section">
      <p className="muted">
        Адреса кошельков/контрактов мостов. По ним кошелёк получает метку моста — появляется кнопка кроссчейн-продолжения и точечный резолв.
        Резолв продолжения поддержан для: <b>{resolverIds.join(", ") || "—"}</b>. Любой другой id моста размечается, но без резолва.
      </p>
      <div className="admin-form">
        <input placeholder="адрес (0x… / T… / …)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <input list="bridge-ids" placeholder="id моста (orbiter / lifi / stargate…)" value={bridge}
          onChange={(e) => setBridge(e.target.value.toLowerCase().trim())} style={{ maxWidth: 170 }} />
        <datalist id="bridge-ids">{resolverIds.map((id) => <option key={id} value={id} />)}</datalist>
        <input placeholder="название (напр. Orbiter Finance: Maker)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" onClick={add} disabled={busy || !address.trim() || !bridge.trim() || !name.trim()}>Добавить</button>
      </div>
      {err && <div className="error">{err}</div>}
      {rows == null ? <p className="muted">Загрузка…</p> : (
        <table className="admin-table">
          <thead><tr><th>Мост</th><th>Название</th><th>Адрес</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.address}>
                <td>{b.bridge}</td>
                <td>{b.name}</td>
                <td className="mono admin-addr">{b.address}</td>
                <td><button className="rm" title="Удалить" onClick={() => remove(b.address)}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Пусто</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
