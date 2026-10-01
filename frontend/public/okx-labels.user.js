// ==UserScript==
// @name         CryptoTracker — метки из OKX Explorer
// @namespace    cryptotracker
// @version      3.0.0
// @description  Сохраняет в общий реестр меток CryptoTracker теги адресов, которые OKX Explorer показывает на открытой вами странице транзакции или адреса.
// @match        https://web3.okx.com/*explorer/*
// @match        https://www.oklink.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

// How it works. OKX renders entity tags ("# Exchange: FixedFloat. User") next
// to addresses; its API sends them encrypted, so the script reads the text the
// page shows in YOUR browser session and posts (address, tag) pairs to
// CryptoTracker — only for pages you open yourself. (A background harvest that
// opened OKX pages on its own was tried and dropped: OKX blocks it within a
// few pages.) Posting needs an admin account; the server enforces it.
(function () {
  'use strict';

  const ADDR_RE = /^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  const SKIP_TAGS = /^(установить личную метку|set (a )?private (name )?tag|личная метка|private tag|добавить метку|add tag)/i;
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
          await apiWith(creds, 'POST', '/explorer/labels/okx', { labels: [] });
          GM_setValue('ct_api', creds.api); GM_setValue('ct_token', creds.token);
          failed.clear();
          close(true);
          render();
        } catch (err) {
          save.disabled = false;
          say(/HTTP 401/.test(err.message) ? 'Токен не принят — скопируйте свежий из приложения'
            : /HTTP 403/.test(err.message) ? 'Этот аккаунт не администратор — отправлять метки могут только админы'
            : /HTTP 404/.test(err.message) ? 'По этому адресу нет API CryptoTracker — проверьте адрес'
            : `Не удалось подключиться: ${err.message}`);
        }
      });
      document.body.appendChild(host);
      (cfg.api ? tokIn : apiIn).focus();
    });
    return dialogOpen;
  }

  // ── tags on the page you're looking at → registry ─────────────────────────
  const sent = new Map();   // address -> tag already posted this session
  const failed = new Map(); // address -> error
  let current = new Map();
  async function send(entries) {
    if (!entries.length || !configured()) return; // the widget offers to connect
    for (let i = 0; i < entries.length; i += 50) {
      const part = entries.slice(i, i + 50);
      try { await api('POST', '/explorer/labels/okx', { labels: part.map(([address, label]) => ({ address, label })) }); part.forEach(([a, t]) => { sent.set(a, t); failed.delete(a); }); }
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
      const unsent = () => [...current].filter(([a, t]) => sent.get(a) !== t);
      if (b.dataset.act === 'send') void send(unsent());
      if (b.dataset.act === 'settings') void settingsDialog().then((ok) => { if (ok) void send(unsent()); });
    });
    return true;
  }
  function render() {
    if (!ensureUi()) return;
    const s = box.querySelector('[data-s]');
    s.textContent = !configured() ? 'не подключён — нажмите, чтобы настроить'
      : `меток: ${current.size} · отправлено ${sent.size}${failed.size ? ` · ошибок ${failed.size}` : ''}${cfg.auto ? '' : ' · авто выкл'}`;
    const rows = [...current].map(([a, t]) => {
      const st = sent.get(a) === t ? '✓' : failed.has(a) ? `✗ ${failed.get(a)}` : '';
      return `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #1f2937"><span style="color:#93c5fd;font-family:ui-monospace,monospace">${esc(a.slice(0, 6))}…${esc(a.slice(-4))}</span><span style="flex:1">${esc(t)}</span><span style="color:${st.startsWith('✗') ? '#f87171' : '#34d399'}">${esc(st)}</span></div>`;
    }).join('');
    const pending = [...current].filter(([a, t]) => sent.get(a) !== t).length;
    const sendBtn = cfg.auto || !pending ? '' : `<button data-act="send" style="${btnCss};background:#2563eb">Отправить в CryptoTracker (${pending})</button>`;
    const conn = configured()
      ? `<div style="margin-top:8px;opacity:.6">API: ${esc(cfg.api)} · <button data-act="settings" style="all:unset;cursor:pointer;text-decoration:underline">изменить</button></div>`
      : `<div style="margin-top:8px;color:#fbbf24">Скрипт не подключён к CryptoTracker — метки никуда не отправляются.</div><button data-act="settings" style="${btnCss};background:#2563eb">Подключить</button>`;
    list.innerHTML = (rows || '<div style="opacity:.6">на этой странице тегов не видно</div>') + (configured() ? sendBtn : '') + conn;
  }

  GM_registerMenuCommand('CryptoTracker: настроить API и токен', () => void settingsDialog());
  GM_registerMenuCommand('CryptoTracker: вкл/выкл автоотправку', () => { GM_setValue('ct_auto', !cfg.auto); render(); });

  // ── loop ──────────────────────────────────────────────────────────────────
  let timer = null;
  function tick() {
    timer = null;
    current = scanTags(document, addrFromHref(location.pathname));
    if (cfg.auto) void send([...current].filter(([a, t]) => sent.get(a) !== t && !failed.has(a)));
    render();
  }
  const schedule = () => { if (!timer) timer = setTimeout(tick, 1200); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();
