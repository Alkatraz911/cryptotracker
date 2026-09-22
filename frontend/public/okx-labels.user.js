// ==UserScript==
// @name         CryptoTracker — метки из OKX Explorer
// @namespace    cryptotracker
// @version      1.0.0
// @description  Собирает теги адресов, которые OKX Explorer показывает на странице (адрес / транзакция), и отправляет их в реестр меток CryptoTracker.
// @match        https://web3.okx.com/*explorer/*
// @match        https://www.oklink.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

// How it works: OKX renders entity tags ("# Exchange: FixedFloat. User") next
// to addresses. This script reads what YOU see in your own browser session —
// it does not call OKX's API — and posts (address, tag) pairs to
// POST {API}/explorer/labels with your CryptoTracker token. From then on the
// tag is applied automatically in every case for the whole team.
(function () {
  'use strict';

  const ADDR_RE = /^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  const SKIP_TAGS = /^(установить личную метку|set (a )?private (name )?tag|личная метка|private tag)/i;

  // ── settings ──────────────────────────────────────────────────────────────
  const cfg = {
    get api() { return (GM_getValue('ct_api', '') || '').replace(/\/$/, ''); },
    get token() { return GM_getValue('ct_token', ''); },
    get auto() { return GM_getValue('ct_auto', true); },
  };
  function setup(force) {
    if (!force && cfg.api && cfg.token) return true;
    const api = prompt('CryptoTracker: адрес API (например https://cryptotracker-api.vercel.app или http://localhost:8787)', cfg.api || '');
    if (api == null) return false;
    const token = prompt('CryptoTracker: токен (в приложении: Настройки → ✎ у метки → «скопировать токен для скрипта»)', cfg.token || '');
    if (token == null) return false;
    GM_setValue('ct_api', api.trim()); GM_setValue('ct_token', token.trim());
    return !!(api.trim() && token.trim());
  }
  GM_registerMenuCommand('CryptoTracker: настроить API и токен', () => setup(true));
  GM_registerMenuCommand('CryptoTracker: вкл/выкл автоотправку', () => { GM_setValue('ct_auto', !cfg.auto); render(); });

  // ── DOM scraping ──────────────────────────────────────────────────────────
  const addrFromHref = (href) => {
    const m = String(href || '').match(/\/(?:address|account)\/([0-9A-Za-z]+)/);
    return m && ADDR_RE.test(m[1]) ? m[1] : null;
  };
  const cleanTag = (t) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^#\s*/, '').trim();
    if (s.length < 2 || s.length > 120 || SKIP_TAGS.test(s)) return null;
    // a bare address or hash is not a tag
    if (ADDR_RE.test(s) || /^0x[0-9a-fA-F]{64}$/.test(s)) return null;
    return s;
  };
  // Tag pills are short leaf-ish elements whose text starts with "#" — or, if
  // the "#" is drawn as an icon, elements whose class names say tag/entity.
  function tagPillsIn(root) {
    const out = [];
    for (const el of root.querySelectorAll('span,div,a,button')) {
      if (el.children.length > 3 || el.querySelector('a[href*="/address/"],a[href*="/account/"]')) continue;
      const t = (el.textContent || '').trim();
      if (t.length < 2 || t.length > 130) continue;
      const byHash = t.startsWith('#');
      const byClass = /(^|[\s_-])(entity|tag|label)([\s_-]|$)/i.test(String(el.className)) && !SKIP_TAGS.test(t) && !/^#?\s*(0x)?[0-9A-Za-z]{30,}$/.test(t);
      if (!byHash && !byClass) continue;
      // keep the innermost element carrying that text
      if ([...el.children].some((c) => (c.textContent || '').trim() === t)) continue;
      out.push(el);
    }
    return out;
  }
  function scan() {
    const found = new Map(); // address -> tag
    // 1) address links with a tag pill nearby (tx pages, transfer tables)
    for (const a of document.querySelectorAll('a[href*="/address/"],a[href*="/account/"]')) {
      const addr = addrFromHref(a.getAttribute('href'));
      if (!addr) continue;
      let node = a;
      for (let up = 0; up < 3 && node.parentElement; up++) {
        node = node.parentElement;
        const pills = tagPillsIn(node);
        // stop at the first ancestor that has exactly one pill and few links —
        // a wider container would mix tags of other addresses
        const links = node.querySelectorAll('a[href*="/address/"],a[href*="/account/"]').length;
        if (pills.length === 1 && links <= 1) { const tag = cleanTag(pills[0].textContent); if (tag) found.set(addr, tag); break; }
        if (pills.length > 1 || links > 1) break;
      }
    }
    // 2) the address page itself: the pill in the header belongs to the URL's address
    const pageAddr = addrFromHref(location.pathname);
    if (pageAddr && !found.has(pageAddr)) {
      const pills = tagPillsIn(document.body).filter((p) => !p.closest('table,tr,[role="row"]'));
      const tag = pills.length ? cleanTag(pills[0].textContent) : null;
      if (tag) found.set(pageAddr, tag);
    }
    return found;
  }

  // ── sending ───────────────────────────────────────────────────────────────
  const sent = new Map();   // address -> tag already posted this session
  const failed = new Map(); // address -> error
  let queue = new Map();
  let busy = false;
  function post(address, label) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST', url: `${cfg.api}/explorer/labels`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
        data: JSON.stringify({ address, label, source: 'okx' }),
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve() : reject(new Error(`HTTP ${r.status}${r.status === 401 ? ' — токен истёк, настройте заново' : ''}`))),
        onerror: () => reject(new Error('сеть')),
      });
    });
  }
  async function flush() {
    if (busy || !queue.size) return;
    if (!setup(false)) return;
    busy = true;
    try {
      for (const [addr, tag] of [...queue]) {
        try { await post(addr, tag); sent.set(addr, tag); failed.delete(addr); }
        catch (e) { failed.set(addr, e.message); }
        queue.delete(addr); render();
      }
    } finally { busy = false; render(); }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  let box, list, open = false;
  function ensureUi() {
    if (box) return;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;background:#0b1020;color:#e5e7eb;border:1px solid #334155;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:420px';
    box.innerHTML = '<div data-h style="padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center"><b>CT</b><span data-s></span><span style="margin-left:auto;opacity:.6">▴</span></div><div data-l style="display:none;border-top:1px solid #334155;max-height:260px;overflow:auto;padding:6px 12px"></div>';
    document.body.appendChild(box);
    list = box.querySelector('[data-l]');
    box.querySelector('[data-h]').addEventListener('click', () => { open = !open; list.style.display = open ? 'block' : 'none'; });
  }
  function render() {
    ensureUi();
    const s = box.querySelector('[data-s]');
    s.textContent = `меток: ${current.size} · отправлено ${sent.size}${failed.size ? ` · ошибок ${failed.size}` : ''}${cfg.auto ? '' : ' · авто выкл'}`;
    const rows = [...current].map(([a, t]) => {
      const st = sent.has(a) ? '✓' : failed.has(a) ? `✗ ${failed.get(a)}` : (queue.has(a) ? '…' : '');
      return `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #1f2937"><span style="color:#93c5fd;font-family:ui-monospace,monospace">${a.slice(0, 6)}…${a.slice(-4)}</span><span style="flex:1">${t.replace(/</g, '&lt;')}</span><span style="color:${st.startsWith('✗') ? '#f87171' : '#34d399'}">${st}</span></div>`;
    }).join('');
    const btn = cfg.auto ? '' : `<button data-send style="margin-top:6px;padding:5px 10px;border-radius:6px;border:1px solid #334155;background:#2563eb;color:#fff;cursor:pointer">Отправить в CryptoTracker (${[...current].filter(([a, t]) => sent.get(a) !== t).length})</button>`;
    list.innerHTML = (rows || '<div style="opacity:.6">на этой странице тегов не видно</div>') + btn;
    const b = list.querySelector('[data-send]');
    if (b) b.addEventListener('click', () => { for (const [a, t] of current) if (sent.get(a) !== t) queue.set(a, t); flush(); });
  }

  // ── loop ──────────────────────────────────────────────────────────────────
  let current = new Map();
  let timer = null;
  function tick() {
    timer = null;
    current = scan();
    if (cfg.auto) for (const [a, t] of current) if (sent.get(a) !== t && !failed.has(a)) queue.set(a, t);
    render();
    flush();
  }
  const schedule = () => { if (!timer) timer = setTimeout(tick, 1200); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();
