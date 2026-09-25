import { tr, locale } from "../lib/i18n";
import { Fragment, useEffect, useState } from "react";
import { store, type AddressLabelEntry, type AdminUser, type Analytics, type BridgeAddress, type FeedbackEntry, type FeedbackStatus, type OkxQueueStats, type User } from "../lib/store";

type Tab = "analytics" | "users" | "bridges" | "labels" | "feedback";

export default function AdminPage({ user, onClose }: { user: User; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("analytics");
  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <button className="admin-back" onClick={onClose}>{tr("← Назад")}</button>
        <h1>{tr("Администрирование")}</h1>
        <span className="admin-who">{user.email}</span>
      </header>
      <nav className="admin-tabs">
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}>{tr("Аналитика")}</button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>{tr("Пользователи")}</button>
        <button className={tab === "bridges" ? "active" : ""} onClick={() => setTab("bridges")}>{tr("Мосты")}</button>
        <button className={tab === "labels" ? "active" : ""} onClick={() => setTab("labels")}>{tr("Метки")}</button>
        <button className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}>{tr("Обратная связь")}</button>
      </nav>
      <div className="admin-page-body">
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "users" && <UsersTab selfId={user.id} />}
        {tab === "bridges" && <BridgesTab />}
        {tab === "labels" && <LabelsTab />}
        {tab === "feedback" && <FeedbackTab />}
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
        <span className="muted">{tr("Период:")}</span>
        {[7, 30, 90].map((d) => (
          <button key={d} className={`admin-range${days === d ? " active" : ""}`} onClick={() => setDays(d)}>{d} {tr("дн.")}</button>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {!data ? <p className="muted">{tr("Загрузка…")}</p> : (
        <>
          <div className="admin-cards">
            <Card label={tr("Событий")} value={data.totalEvents.toLocaleString(locale())} />
            <Card label={tr("Активных пользователей")} value={String(data.activeUsers)} />
            <Card label={tr("Модулей")} value={String(data.byModule.length)} />
          </div>

          <h3 className="admin-h3">{tr("Востребованность модулей")}</h3>
          {data.byModule.length === 0 ? <p className="muted">{tr("Нет данных за период.")}</p> : (
            <div className="usage-bars">
              {data.byModule.map((m) => (
                <div className="usage-bar" key={m.module}>
                  <span className="ub-label">{m.module}</span>
                  <span className="ub-track"><span className="ub-fill" style={{ width: `${(m.count / maxCount) * 100}%` }} /></span>
                  <span className="ub-count">{m.count.toLocaleString(locale())}<i>{m.users} {tr("польз.")}</i></span>
                </div>
              ))}
            </div>
          )}

          <h3 className="admin-h3">{tr("По пользователям")}</h3>
          <table className="admin-table">
            <thead><tr><th>{tr("Пользователь")}</th><th className="num">{tr("Событий")}</th><th>{tr("Активность")}</th><th>{tr("Топ-модули")}</th></tr></thead>
            <tbody>
              {data.byUser.map((u) => (
                <tr key={u.userId}>
                  <td>{u.email}{u.role === "admin" && <span className="role-pill">admin</span>}</td>
                  <td className="num">{u.events.toLocaleString(locale())}</td>
                  <td className="tdate">{u.lastActive ? new Date(u.lastActive).toLocaleString(locale()) : "—"}</td>
                  <td className="muted">{u.modules.slice(0, 3).map((m) => `${m.module} (${m.count})`).join(", ")}</td>
                </tr>
              ))}
              {data.byUser.length === 0 && <tr><td colSpan={4} className="muted">{tr("Нет активности.")}</td></tr>}
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
    catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
    finally { setBusy(false); }
  }
  const create = () => {
    if (!email.trim() || password.length < 6) { setErr(tr("Email и пароль (мин. 6) обязательны")); return; }
    run(() => store.createUser({ email: email.trim(), password, role }))
      .then(() => { setEmail(""); setPassword(""); setRole("user"); });
  };
  const changeRole = (u: AdminUser, r: "user" | "admin") => run(() => store.updateUser(u.id, { role: r }));
  const resetPw = (u: AdminUser) => {
    const pw = window.prompt(tr("Новый пароль для {email} (мин. 6 символов):", { email: u.email }));
    if (pw == null) return;
    if (pw.length < 6) { setErr(tr("Пароль слишком короткий")); return; }
    run(() => store.updateUser(u.id, { password: pw }));
  };
  const del = (u: AdminUser) => {
    if (!window.confirm(tr("Удалить пользователя {email}? Его проекты будут удалены.", { email: u.email }))) return;
    run(() => store.deleteUser(u.id));
  };

  return (
    <div className="admin-section">
      <div className="admin-form">
        <input placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder={tr("пароль (мин. 6)")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as any)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button className="primary" onClick={create} disabled={busy}>{tr("Создать")}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {rows == null ? <p className="muted">{tr("Загрузка…")}</p> : (
        <table className="admin-table">
          <thead><tr><th>Email</th><th>{tr("Роль")}</th><th>{tr("Создан")}</th><th>{tr("Действия")}</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === selfId && <span className="role-pill">{tr("вы")}</span>}</td>
                <td>
                  <select value={u.role} disabled={busy || u.id === selfId} onChange={(e) => changeRole(u, e.target.value as any)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="tdate">{new Date(u.createdAt).toLocaleDateString(locale())}</td>
                <td className="admin-actions">
                  <button onClick={() => resetPw(u)} disabled={busy}>{tr("Сбросить пароль")}</button>
                  {u.id !== selfId && <button className="danger" onClick={() => del(u)} disabled={busy}>{tr("Удалить")}</button>}
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
    catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
    finally { setBusy(false); }
  }
  async function remove(addr: string) {
    setErr(null);
    try { await store.removeBridge(addr); await load(); } catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
  }

  const resolverIds = resolvers.map((r) => r.id);
  return (
    <div className="admin-section">
      <p className="muted">
        {tr("Адреса кошельков/контрактов мостов. По ним кошелёк получает метку моста — появляется кнопка кроссчейн-продолжения и точечный резолв. Резолв продолжения поддержан для:")} <b>{resolverIds.join(", ") || "—"}</b>{tr(". Любой другой id моста размечается, но без резолва.")}
      </p>
      <div className="admin-form">
        <input placeholder={tr("адрес (0x… / T… / …)")} value={address} onChange={(e) => setAddress(e.target.value)} />
        <input list="bridge-ids" placeholder={tr("id моста (orbiter / lifi / stargate…)")} value={bridge}
          onChange={(e) => setBridge(e.target.value.toLowerCase().trim())} style={{ maxWidth: 170 }} />
        <datalist id="bridge-ids">{resolverIds.map((id) => <option key={id} value={id} />)}</datalist>
        <input placeholder={tr("название (напр. Orbiter Finance: Maker)")} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" onClick={add} disabled={busy || !address.trim() || !bridge.trim() || !name.trim()}>{tr("Добавить")}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {rows == null ? <p className="muted">{tr("Загрузка…")}</p> : (
        <table className="admin-table">
          <thead><tr><th>{tr("Мост")}</th><th>{tr("Название")}</th><th>{tr("Адрес")}</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.address}>
                <td>{b.bridge}</td>
                <td>{b.name}</td>
                <td className="mono admin-addr">{b.address}</td>
                <td><button className="rm" title={tr("Удалить")} onClick={() => remove(b.address)}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">{tr("Пусто")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Address labels ───────────────────────────────────────────────────────────
const sourceLabel = (s: string): string =>
  ({ manual: tr("вручную"), okx: "OKX", tronscan: "TronScan", etherscan: "Etherscan", solscan: "Solscan" } as Record<string, string>)[s] ?? s;

// "address<TAB or , or ;>label" per line — what you get pasting from a sheet.
function parseLabelLines(text: string): { address: string; label: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\S+)[\t,;]+\s*(.+)$/);
    return m ? { address: m[1], label: m[2].trim() } : null;
  }).filter((x): x is { address: string; label: string } => !!x && x.label.length > 0);
}

function LabelsTab() {
  const [rows, setRows] = useState<AddressLabelEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const [queue, setQueue] = useState<OkxQueueStats | null>(null);

  const load = () => {
    store.okxQueueStats().then(setQueue).catch(() => setQueue(null));
    return store.listLabels().then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); }, []);

  async function add() {
    if (!address.trim() || !label.trim()) return;
    setBusy(true); setErr(null);
    try { await store.setLabel({ address: address.trim(), label: label.trim(), source: "okx" }); setAddress(""); setLabel(""); await load(); }
    catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
    finally { setBusy(false); }
  }
  async function importBulk() {
    const entries = parseLabelLines(bulk).map((e) => ({ ...e, source: "okx" as const }));
    if (!entries.length) { setBulkMsg(tr("Не распознано ни одной строки — формат: адрес, метка")); return; }
    setBusy(true); setErr(null); setBulkMsg(null);
    try { const { imported } = await store.importLabels(entries); setBulkMsg(tr("Импортировано: {n}", { n: imported })); setBulk(""); await load(); }
    catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
    finally { setBusy(false); }
  }
  async function remove(addr: string) {
    setErr(null);
    try { await store.removeLabel(addr); await load(); } catch (e: any) { setErr(e.message ?? tr("Ошибка")); }
  }

  const shown = (rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    return !s || r.address.toLowerCase().includes(s) || r.label.toLowerCase().includes(s) || (r.createdBy ?? "").toLowerCase().includes(s);
  });

  return (
    <div className="admin-section">
      <p className="muted">
        Общий реестр меток адресов (биржи, обменники, миксеры). Проверяется первым при добавлении адреса на граф — раньше эксплореров.
        Теги TronScan/Etherscan запоминаются сами при добавлении адреса или загрузке транзакций. Метки OKX Explorer собирает
        {" "}<a href="/okx-labels.user.js" target="_blank" rel="noreferrer">скрипт для браузера</a> (Tampermonkey): каждый адрес, добавленный
        любым пользователем, попадает в очередь, а скрипт в режиме «Сбор» открывает на OKX страницу его транзакции и сохраняет теги обеих сторон.
      </p>
      {queue && (
        <p className="muted">
          Очередь OKX: ждут {queue.pending - queue.waitingTx}
          {queue.waitingTx ? ` (+${queue.waitingTx} без транзакции)` : ""} · собрано {queue.done} · без тега на OKX {queue.none}
          {queue.failed ? ` · не удалось ${queue.failed}` : ""}
        </p>
      )}
      <div className="admin-form">
        <input placeholder={tr("адрес (0x… / T… / …)")} value={address} onChange={(e) => setAddress(e.target.value)} />
        <input placeholder={tr("метка (напр. FixedFloat. User)")} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="primary" onClick={add} disabled={busy || !address.trim() || !label.trim()}>{tr("Добавить")}</button>
      </div>
      <details className="admin-bulk">
        <summary>{tr("Массовый импорт (адрес, метка — по строке)")}</summary>
        <textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)}
          placeholder={"TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP\tFixedFloat. User\n0x28c6c06298d514db089934071355e5743bf21d60, Binance 14"} />
        <div className="admin-form">
          <button className="primary" onClick={importBulk} disabled={busy || !bulk.trim()}>{tr("Импортировать")}</button>
          {bulkMsg && <span className="muted">{bulkMsg}</span>}
        </div>
      </details>
      {err && <div className="error">{err}</div>}
      <input className="admin-search" placeholder={tr("поиск по адресу / метке / автору")} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows == null ? <p className="muted">{tr("Загрузка…")}</p> : (
        <table className="admin-table">
          <thead><tr><th>{tr("Метка")}</th><th>{tr("Адрес")}</th><th>{tr("Источник")}</th><th>{tr("Кто")}</th><th>{tr("Когда")}</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.address}>
                <td>{r.label}</td>
                <td className="mono admin-addr" title={r.address}>{r.address}</td>
                <td>{sourceLabel(r.source)}</td>
                <td className="admin-addr">{r.createdBy ?? "—"}</td>
                <td className="tdate">{new Date(r.updatedAt).toLocaleDateString(locale())}</td>
                <td><button className="rm" title={tr("Удалить")} onClick={() => remove(r.address)}>✕</button></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="muted">{tr("Пусто")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Feedback inbox ───────────────────────────────────────────────────────────
const kindLabel = (k: string): string =>
  ({ bug: tr("🐞 ошибка"), idea: tr("💡 идея") } as Record<string, string>)[k] ?? k;

function FeedbackTab() {
  const [filter, setFilter] = useState<FeedbackStatus | "all">("new");
  const [rows, setRows] = useState<FeedbackEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  function load() {
    setErr(null);
    store.listFeedback(filter === "all" ? undefined : filter).then(setRows).catch((e) => setErr(e.message));
  }
  useEffect(load, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(e: FeedbackEntry) {
    const status: FeedbackStatus = e.status === "new" ? "done" : "new";
    try {
      const u = await store.setFeedbackStatus(e.id, status);
      setRows((r) => (r ?? []).map((x) => (x.id === u.id ? { ...x, status: u.status } : x)));
    } catch (ex: any) { setErr(ex.message); }
  }

  return (
    <div className="admin-section">
      <div className="admin-rangebar">
        <span className="muted">{tr("Показать:")}</span>
        {([["new", tr("новые")], ["done", tr("разобранные")], ["all", tr("все")]] as const).map(([v, l]) => (
          <button key={v} className={`admin-range${filter === v ? " active" : ""}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {!rows ? <p className="muted">{tr("Загрузка…")}</p> : rows.length === 0 ? <p className="muted">{tr("Пусто.")}</p> : (
        <table className="admin-table fb-table">
          <thead><tr><th>{tr("Дата")}</th><th>{tr("Тип")}</th><th>{tr("Тема")}</th><th>{tr("От кого")}</th><th></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <Fragment key={e.id}>
                <tr className={`fb-row${e.status === "done" ? " done" : ""}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td className="tdate">{new Date(e.createdAt).toLocaleString(locale())}</td>
                  <td>{kindLabel(e.kind)}</td>
                  <td className="fb-title">{e.title}</td>
                  <td className="admin-addr">{e.email}</td>
                  <td className="admin-actions">
                    <button onClick={(ev) => { ev.stopPropagation(); void toggle(e); }}>
                      {e.status === "new" ? tr("✓ разобрано") : tr("↩ в новые")}
                    </button>
                  </td>
                </tr>
                {open === e.id && (
                  <tr className="fb-detail">
                    <td colSpan={5}>
                      <pre className="fb-message">{e.message}</pre>
                      {e.context && (
                        <dl className="fb-ctx">
                          {Object.entries(e.context).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                            <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>
                          ))}
                        </dl>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
