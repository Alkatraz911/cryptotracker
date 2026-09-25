// ==UserScript==
// @name         CryptoTracker — метки из OKX Explorer
// @namespace    cryptotracker
// @version      2.2.0
// @description  Собирает теги адресов, которые OKX Explorer показывает на страницах транзакций и адресов, и сохраняет их в общий реестр меток CryptoTracker. В режиме «Сбор» сам обходит очередь адресов без меток.
// @match        https://web3.okx.com/*explorer/*
// @match        https://www.oklink.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

// How it works. OKX renders entity tags ("# Exchange: FixedFloat. User") next
// to addresses; its API sends them encrypted, so the script reads the text the
// page shows in YOUR browser session and posts (address, tag) pairs to
// CryptoTracker. Two modes:
//  • passive — any OKX tx/address page you open: its tags go to the registry;
//  • «Сбор» (harvest) — the tab you switch it on in takes addresses without an
//    OKX tag from the server queue (every address any user added to a graph),
//    opens the OKX page of a transaction of each in a background tab, reads
//    the tags of both sides and closes it. One task every ~8 s.
(function () {
  'use strict';

  const ADDR_RE = /^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  const SKIP_TAGS = /^(установить личную метку|set (a )?private (name )?tag|личная метка|private tag|добавить метку|add tag)/i;
  const OKX_SLUGS = { ETH: 'ethereum', BSC: 'bsc', POLYGON: 'polygon', ARBITRUM: 'arbitrum-one', BASE: 'base', TRON: 'tron', SOLANA: 'sol' };
  const same = (a, b) => (/^0x/i.test(a) ? a.toLowerCase() === String(b).toLowerCase() : a === b);

  // ── page parsing (pure — takes a Document) ────────────────────────────────
  const addrFromHref = (href) => {
    const m = String(href || '').match(/\/(?:address|account)\/([0-9A-Za-z]+)/);
    return m && ADDR_RE.test(m[1]) ? m[1] : null;
  };
  const cleanTag = (t) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^#\s*/, '').trim();
    if (s.length < 2 || s.length > 120 || SKIP_TAGS.test(s)) return null;
    if (ADDR_RE.test(s) || /^0x[0-9a-fA-F]{64}$/.test(s)) return null; // a bare address/hash is not a tag
    if (/^[\d\s.,:#-]+$/.test(s)) return null;                        // "#58436066" — a block/nonce, not a tag
    return s;
  };
  // Elements that name an address: links to /address/…, or a leaf whose whole
  // text is an address (OKX sometimes draws the address as plain text).
  function addressNodes(doc) {
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="/address/"],a[href*="/account/"]')) {
      const addr = addrFromHref(a.getAttribute('href'));
      if (addr) out.push({ el: a, addr });
    }
    for (const el of doc.querySelectorAll('span,div,a')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (ADDR_RE.test(t) && t.length >= 32 && !el.closest('a[href*="/address/"],a[href*="/account/"]')) out.push({ el, addr: t });
    }
    return out;
  }
  // Tag pills. OKX today: <div class="tag-77uC6 …"><div data-testid="okd-popup" …>
  // <div class="text-ellipsis"># Exchange: FixedFloat. User</div>. The hash
  // suffix of the class changes with every OKX deploy, so match the prefix;
  // fall back to "short text starting with #".
  function tagNodes(doc) {
    const out = new Set();
    for (const el of doc.querySelectorAll('[class^="tag-"],[class*=" tag-"]')) out.add(el.querySelector('.text-ellipsis') || el);
    for (const el of doc.querySelectorAll('span,div')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').trim();
      if (t.startsWith('#') && t.length <= 130 && ![...el.children].some((c) => (c.textContent || '').trim() === t)) out.add(el);
    }
    // keep only the innermost of nested matches
    const list = [...out];
    return list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
  }
  // address → tag for every tagged address on the page. From each address we
  // climb to the nearest ancestor that holds a tag pill; an ancestor that also
  // holds a DIFFERENT address is a shared container (e.g. the whole sender/
  // receiver block), so the search stops there.
  function scanTags(doc, pageAddr) {
    const addrs = addressNodes(doc);
    const tags = tagNodes(doc).map((el) => ({ el, tag: cleanTag(el.textContent) })).filter((t) => t.tag);
    const found = new Map();
    for (const { el, addr } of addrs) {
      if (found.has(addr)) continue;
      let node = el;
      for (let up = 0; up < 10 && node.parentElement && node !== doc.body; up++) {
        node = node.parentElement;
        if (addrs.some((o) => !same(o.addr, addr) && node.contains(o.el))) break;
        const t = tags.find((x) => node.contains(x.el));
        if (t) { found.set(addr, t.tag); break; }
      }
    }
    // The address page itself: a pill outside tables belongs to the URL's address.
    if (pageAddr && ![...found.keys()].some((a) => same(a, pageAddr))) {
      const t = tags.find((x) => !x.el.closest('table,tr,[role="row"]') && ![...found.values()].includes(x.tag));
      if (t) found.set(pageAddr, t.tag);
    }
    return found;
  }

  // Unit tests load this file with a DOM and call the parser directly.
  if (typeof GM_getValue === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { scanTags, cleanTag };
    return;
  }

  // ── which addresses OKX says are tagged (from its own API response) ──────
  // The tag text itself is encrypted, but the response is keyed by address:
  // that tells us "tagged, wait for the pill" vs "OKX has no tag for it".
  const apiTagged = new Set();
  let apiSeen = false;
  function noteTagResponse(url, text) {
    if (!/tag|support/i.test(url)) return;
    try {
      const j = JSON.parse(text);
      const d = j && j.data;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return;
      const keys = Object.keys(d).filter((k) => ADDR_RE.test(k));
      if (!keys.length || !keys.every((k) => d[k] && typeof d[k] === 'object' && ('entityTag' in d[k] || 'entityTags' in d[k]))) return;
      apiSeen = true;
      keys.forEach((k) => apiTagged.add(k));
    } catch { /* not JSON */ }
  }
  try {
    const w = unsafeWindow;
    const origFetch = w.fetch;
    w.fetch = function (input, init) {
      const p = origFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/tag|support/i.test(url)) p.then((r) => r.clone().text().then((t) => noteTagResponse(url, t))).catch(() => {});
      return p;
    };
    const origOpen = w.XMLHttpRequest.prototype.open;
    w.XMLHttpRequest.prototype.open = function (m, url) {
      if (/tag|support/i.test(String(url))) this.addEventListener('load', () => { try { noteTagResponse(String(url), this.responseText); } catch { /* binary */ } });
      return origOpen.apply(this, arguments);
    };
  } catch { /* no page access — DOM only */ }

  // Only admin accounts may write harvested tags (the server enforces it).
  // ── settings & API ────────────────────────────────────────────────────────
  const cfg = {
    get api() { return (GM_getValue('ct_api', '') || '').replace(/\/$/, ''); },
    get token() { return GM_getValue('ct_token', ''); },
    get auto() { return GM_getValue('ct_auto', true); },
  };
  const configured = () => !!(cfg.api && cfg.token);
  function apiWith(creds, method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url: `${creds.api}${path}`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) { try { resolve(r.responseText ? JSON.parse(r.responseText) : null); } catch { resolve(null); } }
          else reject(new Error(`HTTP ${r.status}${r.status === 401 ? ' — токен истёк, настройте заново' : r.status === 403 ? ' — нужен аккаунт администратора' : ''}`));
        },
        onerror: () => reject(new Error('сеть')),
        ontimeout: () => reject(new Error('таймаут')),
        timeout: 20000,
      });
    });
  }
  const api = (method, path, body) => apiWith({ api: cfg.api, token: cfg.token }, method, path, body);

  // Settings dialog. An in-page modal instead of prompt(): prompt() vanishes
  // when you switch tabs to copy the token. Lives in a shadow root so OKX's
  // CSS can't touch it, and swallows key events so OKX hotkeys ("/" focuses
  // their search) don't steal the typing. Saves only after the server
  // accepted the token as an admin's.
  let dialogOpen = null;
  function settingsDialog(reason) {
    if (dialogOpen) return dialogOpen;
    dialogOpen = new Promise((resolve) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      for (const ev of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut', 'input']) host.addEventListener(ev, (e) => e.stopPropagation());
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .bg{position:fixed;inset:0;background:rgba(2,6,23,.6);display:flex;align-items:center;justify-content:center;font:13px/1.45 system-ui,sans-serif}
        form{width:min(460px,calc(100vw - 32px));background:#0b1020;color:#e5e7eb;border:1px solid #334155;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:18px 20px}
        h2{margin:0 0 4px;font-size:15px} p{margin:0 0 12px;color:#94a3b8}
        label{display:block;margin:10px 0 4px;color:#cbd5e1}
        input{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#020617;color:#e5e7eb;font:12px ui-monospace,monospace}
        input:focus{outline:2px solid #0f766e;border-color:#0f766e}
        .msg{min-height:18px;margin-top:10px;color:#f87171} .msg.ok{color:#34d399}
        .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
        button{padding:7px 14px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;cursor:pointer;font:inherit}
        button.primary{background:#0f766e;border-color:#0f766e} button:disabled{opacity:.6;cursor:default}
      </style>
      <div class="bg"><form>
        <h2>CryptoTracker — подключение</h2>
        <p>${reason ? esc(reason) + ' ' : ''}В приложении под аккаунтом администратора: панель узла → ✎ → «скопировать токен для скрипта», затем вставьте сюда (можно целиком в любое поле).</p>
        <label for="api">Адрес API</label>
        <input id="api" placeholder="https://cryptotracker-api.vercel.app" autocomplete="off" spellcheck="false">
        <label for="token">Токен</label>
        <input id="token" placeholder="eyJhbGciOi…" autocomplete="off" spellcheck="false">
        <div class="msg" id="msg"></div>
        <div class="row"><button type="button" id="cancel">Отмена</button><button type="submit" class="primary" id="save">Проверить и сохранить</button></div>
      </form></div>`;
      const $ = (id) => root.getElementById(id);
      const apiIn = $('api'), tokIn = $('token'), msg = $('msg'), save = $('save');
      apiIn.value = cfg.api; tokIn.value = cfg.token;
      const isUrl = (x) => /^https?:\/\//.test(x);
      // The app copies "api\ntoken" — split it wherever it was pasted.
      for (const inp of [apiIn, tokIn]) inp.addEventListener('paste', (e) => {
        const parts = ((e.clipboardData && e.clipboardData.getData('text')) || '').split(/\s+/).filter(Boolean);
        if (parts.length < 2) return;
        e.preventDefault();
        apiIn.value = parts.find(isUrl) || apiIn.value;
        tokIn.value = parts.find((x) => !isUrl(x)) || tokIn.value;
      });
      const say = (text, ok) => { msg.className = ok ? 'msg ok' : 'msg'; msg.textContent = text; };
      const close = (ok) => { host.remove(); dialogOpen = null; resolve(ok); };
      $('cancel').addEventListener('click', () => close(false));
      root.querySelector('.bg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) close(false); });
      host.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
      root.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const creds = { api: apiIn.value.trim().replace(/\/+$/, ''), token: tokIn.value.trim().replace(/^Bearer\s+/i, '') };
        if (!/^https?:\/\/\S+$/.test(creds.api)) { say('Адрес API должен начинаться с http:// или https://'); apiIn.focus(); return; }
        if (!creds.token) { say('Вставьте токен'); tokIn.focus(); return; }
        save.disabled = true; say('Проверяю…', true);
        try {
          await apiWith(creds, 'GET', '/explorer/labels/okx-queue/stats');
          GM_setValue('ct_api', creds.api); GM_setValue('ct_token', creds.token);
          failed.clear();
          close(true);
          render();
        } catch (err) {
          save.disabled = false;
          say(/HTTP 401/.test(err.message) ? 'Токен не принят — скопируйте свежий из приложения'
            : /HTTP 403/.test(err.message) ? 'Этот аккаунт не администратор — сбор меток доступен только админам'
            : /HTTP 404/.test(err.message) ? 'По этому адресу нет API CryptoTracker — проверьте адрес'
            : `Не удалось подключиться: ${err.message}`);
        }
      });
      document.body.appendChild(host);
      (cfg.api ? tokIn : apiIn).focus();
    });
    return dialogOpen;
  }
  // Tags seen on a page → registry (never overwrites a label typed in the app).
  const reportTags = (address, status, tags, error) =>
    api('POST', '/explorer/labels/okx-queue/report', { address, status, labels: tags.map(([a, t]) => ({ address: a, label: t })), error });

  // ── harvest: controller (the tab «Сбор» was switched on in) ───────────────
  const TAB_ID = Math.random().toString(36).slice(2);
  const JOB_TIMEOUT = 45000;
  const harvest = { on: false, task: null, done: 0, none: 0, fails: 0, note: '', queue: null };

  const isController = () => { const l = GM_getValue('ct_ctrl', null); return !!l && l.id === TAB_ID; };
  function takeControl() {
    const l = GM_getValue('ct_ctrl', null);
    if (l && l.id !== TAB_ID && Date.now() - l.ts < 15000) return false; // another tab runs it
    GM_setValue('ct_ctrl', { id: TAB_ID, ts: Date.now() });
    return true;
  }
  setInterval(() => { if (harvest.on && isController()) GM_setValue('ct_ctrl', { id: TAB_ID, ts: Date.now() }); }, 5000);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function waitResult(jobId) {
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(t); GM_removeValueChangeListener(id); resolve(v); };
      const t = setTimeout(() => done(null), JOB_TIMEOUT);
      const id = GM_addValueChangeListener('ct_result', (_k, _o, v) => { if (v && v.jobId === jobId) done(v); });
    });
  }
  async function harvestLoop() {
    while (harvest.on && isController()) {
      let task = null;
      try {
        harvest.queue = await api('GET', '/explorer/labels/okx-queue/stats');
        task = (await api('POST', '/explorer/labels/okx-queue/claim')).task;
      } catch (e) { harvest.note = `API: ${e.message}`; render(); await sleep(30000); continue; }
      if (!task) { harvest.task = null; harvest.note = 'очередь пуста — проверю через минуту'; render(); await sleep(60000); continue; }
      const slug = OKX_SLUGS[task.network];
      if (!slug) { await reportTags(task.address, 'failed', [], `сеть ${task.network} не поддерживается`).catch(() => {}); continue; }

      harvest.task = task; harvest.note = ''; render();
      const jobId = Math.random().toString(36).slice(2);
      const url = `https://web3.okx.com/explorer/${slug}/tx/${task.txHash}`;
      GM_setValue('ct_job', { jobId, task, ts: Date.now() });
      const tab = GM_openInTab(url, { active: false, insert: true, setParent: true });
      const res = await waitResult(jobId);
      try { tab.close(); } catch { /* already closed */ }

      const status = res ? res.status : 'failed';
      try { await reportTags(task.address, status, res ? res.tags : [], res ? res.error : 'страница OKX не ответила за 45 с'); }
      catch (e) { harvest.note = `отчёт: ${e.message}`; }
      if (status === 'found') harvest.done++; else if (status === 'none') harvest.none++;
      // Several dead pages in a row = OKX wants a human check (captcha / risk).
      harvest.fails = status === 'failed' ? harvest.fails + 1 : 0;
      if (harvest.fails >= 3) {
        setHarvest(false);
        harvest.note = 'OKX перестал отдавать страницы — откройте любую вкладку OKX, пройдите проверку и включите сбор снова';
      }
      harvest.task = null; render();
      await sleep(6000 + Math.random() * 4000);
    }
  }
  async function setHarvest(on) {
    if (on && !configured() && !(await settingsDialog('Для сбора нужно подключение к CryptoTracker.'))) return;
    if (on && !takeControl()) { harvest.note = 'сбор уже идёт в другой вкладке OKX'; render(); return; }
    harvest.on = on;
    if (!on && isController()) GM_setValue('ct_ctrl', null);
    if (on) { harvest.fails = 0; void harvestLoop(); }
    render();
  }

  // ── harvest: worker (a tab the controller opened) ─────────────────────────
  function currentJob() {
    const j = GM_getValue('ct_job', null);
    return j && Date.now() - j.ts < JOB_TIMEOUT && location.pathname.includes(j.task.txHash) ? j : null;
  }
  async function runWorker(job) {
    const target = job.task.address;
    const started = Date.now();
    let seenAt = 0; // when the target address first rendered
    let result = null;
    while (!result) {
      await sleep(1000);
      const tags = scanTags(document, null);
      const hasAddr = addressNodes(document).some((x) => same(x.addr, target));
      const mine = [...tags.keys()].find((a) => same(a, target));
      if (hasAddr && !seenAt) seenAt = Date.now();
      const apiSaysTagged = [...apiTagged].some((a) => same(a, target));
      if (mine) result = { status: 'found' };
      else if (seenAt && apiSeen && !apiSaysTagged && Date.now() - seenAt > 4000) result = { status: 'none' };
      else if (seenAt && apiSaysTagged && Date.now() - seenAt > 12000) result = { status: 'failed', error: 'OKX отдал тег, но на странице он не найден — сменилась вёрстка?' };
      else if (seenAt && !apiSeen && Date.now() - seenAt > 10000) result = { status: 'none' };
      else if (Date.now() - started > JOB_TIMEOUT - 5000) result = { status: 'failed', error: seenAt ? 'теги не прогрузились' : 'страница не отрисовалась (проверка OKX?)' };
      if (result) result.tags = [...tags];
    }
    GM_setValue('ct_result', { jobId: job.jobId, ...result });
  }

  // ── passive: tags on the page you're looking at ───────────────────────────
  const sent = new Map();   // address -> tag already posted this session
  const failed = new Map(); // address -> error
  let current = new Map();
  async function sendPassive(entries) {
    if (!entries.length || !configured()) return; // the widget offers to connect
    for (let i = 0; i < entries.length; i += 50) {
      const part = entries.slice(i, i + 50);
      try { await reportTags(part[0][0], 'found', part); part.forEach(([a, t]) => { sent.set(a, t); failed.delete(a); }); }
      catch (e) { part.forEach(([a]) => failed.set(a, e.message)); }
    }
    render();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  let box, list, open = false;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const btnCss = 'margin:6px 6px 0 0;padding:5px 10px;border-radius:6px;border:1px solid #334155;color:#fff;cursor:pointer';
  function ensureUi() {
    if (box || !document.body) return !!box;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;background:#0b1020;color:#e5e7eb;border:1px solid #334155;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:440px';
    box.innerHTML = '<div data-h style="padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center"><b>CT</b><span data-s></span><span style="margin-left:auto;opacity:.6">▴</span></div><div data-l style="display:none;border-top:1px solid #334155;max-height:300px;overflow:auto;padding:6px 12px"></div>';
    document.body.appendChild(box);
    list = box.querySelector('[data-l]');
    box.querySelector('[data-h]').addEventListener('click', () => { open = !open; list.style.display = open ? 'block' : 'none'; });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'harvest') void setHarvest(!harvest.on);
      if (b.dataset.act === 'settings') void settingsDialog().then((ok) => { if (ok) void sendPassive([...current].filter(([a, t]) => sent.get(a) !== t)); });
      if (b.dataset.act === 'send') void sendPassive([...current].filter(([a, t]) => sent.get(a) !== t));
    });
    return true;
  }
  function render() {
    if (!ensureUi()) return;
    const s = box.querySelector('[data-s]');
    const h = harvest.on ? ` · сбор: +${harvest.done}${harvest.task ? ' …' : ''}` : '';
    s.textContent = !configured() ? 'не подключён — нажмите, чтобы настроить' : `меток: ${current.size} · отправлено ${sent.size}${failed.size ? ` · ошибок ${failed.size}` : ''}${h}`;
    const rows = [...current].map(([a, t]) => {
      const st = sent.get(a) === t ? '✓' : failed.has(a) ? `✗ ${failed.get(a)}` : '';
      return `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #1f2937"><span style="color:#93c5fd;font-family:ui-monospace,monospace">${esc(a.slice(0, 6))}…${esc(a.slice(-4))}</span><span style="flex:1">${esc(t)}</span><span style="color:${st.startsWith('✗') ? '#f87171' : '#34d399'}">${esc(st)}</span></div>`;
    }).join('');
    const q = harvest.queue;
    const hv = `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #1f2937">
      <div><b>Сбор по очереди</b> ${harvest.on ? '— идёт' : '— выключен'}${q ? ` · в очереди ${Math.max(0, q.pending - q.waitingTx)}` : ''}</div>
      ${harvest.on ? `<div style="opacity:.75">собрано ${harvest.done} · без тега ${harvest.none}${harvest.task ? ` · сейчас ${esc(harvest.task.address.slice(0, 6))}…` : ''}</div>` : ''}
      ${harvest.note ? `<div style="color:#fbbf24">${esc(harvest.note)}</div>` : ''}
      ${harvest.on ? '<div style="opacity:.6">Оставьте эту вкладку открытой; фоновые вкладки OKX открываются и закрываются сами.</div>' : ''}
      <button data-act="harvest" style="${btnCss};background:${harvest.on ? '#7f1d1d' : '#0f766e'}">${harvest.on ? 'Остановить сбор' : 'Включить сбор'}</button>
    </div>`;
    const pending = [...current].filter(([a, t]) => sent.get(a) !== t).length;
    const sendBtn = cfg.auto || !pending ? '' : `<button data-act="send" style="${btnCss};background:#2563eb">Отправить в CryptoTracker (${pending})</button>`;
    const conn = configured()
      ? `<div style="margin-top:8px;opacity:.6">API: ${esc(cfg.api)} · <button data-act="settings" style="all:unset;cursor:pointer;text-decoration:underline">изменить</button></div>`
      : `<div style="margin-top:8px;color:#fbbf24">Скрипт не подключён к CryptoTracker — метки никуда не отправляются.</div><button data-act="settings" style="${btnCss};background:#2563eb">Подключить</button>`;
    list.innerHTML = (rows || '<div style="opacity:.6">на этой странице тегов не видно</div>') + (configured() ? sendBtn : '') + conn + hv;
  }

  GM_registerMenuCommand('CryptoTracker: настроить API и токен', () => void settingsDialog());
  GM_registerMenuCommand('CryptoTracker: вкл/выкл автоотправку', () => { GM_setValue('ct_auto', !cfg.auto); render(); });
  GM_registerMenuCommand('CryptoTracker: вкл/выкл сбор по очереди', () => void setHarvest(!harvest.on));

  // ── start ─────────────────────────────────────────────────────────────────
  function start() {
    const job = currentJob();
    if (job) { void runWorker(job); return; } // a harvest tab: no widget, no passive posting
    let timer = null;
    const tick = () => {
      timer = null;
      current = scanTags(document, addrFromHref(location.pathname));
      if (cfg.auto) void sendPassive([...current].filter(([a, t]) => sent.get(a) !== t && !failed.has(a)));
      render();
    };
    const schedule = () => { if (!timer) timer = setTimeout(tick, 1200); };
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
