// Server-side explorer enrichment (no browser CORS, API key stays here).
// Best-effort: returns null on any failure so the client can fall back to
// the values parsed from the URL.

// OKX Explorer embeds address entity tags as JSON state in the SSR HTML —
// no Cloudflare protection, accessible with a plain fetch().
// Chain slugs used in OKX Explorer URLs:
const OKX_CHAINS = {
  ETH: "eth", BSC: "bsc", POLYGON: "polygon",
  ARBITRUM: "arbitrum-one", BASE: "base",
};

async function fetchExplorerHtmlLabel(network, address) {
  const chain = OKX_CHAINS[network];
  if (!chain) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(`https://web3.okx.com/explorer/${chain}/address/${address}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: ac.signal,
    });
    if (!r.ok) return null;
    const html = await r.text();
    // OKX embeds state JSON in the page; hoverEntityTag is the full display label
    // e.g. "Bridge: deBridge DLN" or "Exchange: Binance"
    const m1 = html.match(/"hoverEntityTag"\s*:\s*"([^"]{2,100})"/);
    if (m1?.[1]) return m1[1];
    const m2 = html.match(/"entityTag"\s*:\s*"([^"]{2,100})"/);
    if (m2?.[1]) return m2[1];
    return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

const EVM_CHAINS = { ETH: 1, BSC: 56, POLYGON: 137, ARBITRUM: 42161, BASE: 8453 };
const EVM_BASE = "https://api.etherscan.io/v2/api";
// Public RPC fallback — no API key required (official / highly available endpoints)
const PUBLIC_RPC = {
  ETH:      "https://eth.llamarpc.com",
  BSC:      "https://bsc-dataseed.binance.org",
  POLYGON:  "https://polygon-rpc.com",
  ARBITRUM: "https://arb1.arbitrum.io/rpc",
  BASE:     "https://mainnet.base.org",
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpcPost(rpc, method, params) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ac.signal,
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// Decode ABI-encoded string returned by eth_call (handles both string and bytes32 encoding).
function decodeAbiString(hex) {
  if (!hex || hex === "0x") return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 128) {
    // bytes32 fallback (old tokens like MKR)
    const s = Buffer.from(h.padEnd(64, "0"), "hex").toString("utf8").replace(/\0/g, "").trim();
    return s.length && s.length <= 32 ? s : null;
  }
  const len = parseInt(h.slice(64, 128), 16);
  if (!len || len > 200) return null;
  try {
    return Buffer.from(h.slice(128, 128 + len * 2), "hex").toString("utf8").replace(/\0/g, "").trim() || null;
  } catch { return null; }
}
const TRON_BASE = "https://apilist.tronscanapi.com/api";
const SOLSCAN_PUBLIC = "https://public-api.solscan.io";
const SOLSCAN_PRO = "https://pro-api.solscan.io/v2.0";

// Read keys lazily so they reflect .env loaded at startup (not import order).
const evmKey = () => process.env.ETHERSCAN_API_KEY || "";
const tronKey = () => process.env.TRONSCAN_API_KEY || "";
const solscanKey = () => process.env.SOLSCAN_API_KEY || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch JSON, retrying on Etherscan's "rate limit reached" (free tier ~3-5/sec).
async function fetchJsonRetry(url, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    const j = await r.json();
    last = j;
    const note = `${j.message || ""} ${typeof j.result === "string" ? j.result : ""}`;
    if (/rate limit/i.test(note)) {
      await sleep(300 * (i + 1));
      continue;
    }
    return j;
  }
  return last;
}

async function evmTxRpc(network, hash) {
  const rpc = PUBLIC_RPC[network];
  if (!rpc) return null;

  let tx;
  try {
    tx = await rpcPost(rpc, "eth_getTransactionByHash", [hash]);
  } catch (e) {
    console.error(`[evmTxRpc] ${network} RPC (${rpc}) error: ${e?.message || e}`);
    return null;
  }
  if (!tx || !tx.from) {
    console.warn(`[evmTxRpc] ${network} tx not found: ${hash}`);
    return null;
  }

  const nativeValue = BigInt(tx.value ?? "0x0");

  // Always fetch receipt — need ERC-20 logs even when native value > 0
  const receipt = await rpcPost(rpc, "eth_getTransactionReceipt", [hash]).catch(() => null);
  const transferLogs = (receipt?.logs ?? []).filter(
    (l) => l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics.length >= 3
  );

  const all = [];

  // Native transfer (if any value was moved)
  if (nativeValue > 0n) {
    all.push({ from: tx.from, to: tx.to, amount: Number(nativeValue) / 1e18, asset: nativeAsset(network) });
  }

  // ERC-20 transfers from receipt logs
  if (transferLogs.length > 0) {
    const contracts = [...new Set(transferLogs.map((l) => l.address.toLowerCase()))];
    const tokenInfo = {};
    await Promise.all(contracts.map(async (addr) => {
      const [symHex, decHex] = await Promise.all([
        rpcPost(rpc, "eth_call", [{ to: addr, data: "0x95d89b41" }, "latest"]).catch(() => null),
        rpcPost(rpc, "eth_call", [{ to: addr, data: "0x313ce567" }, "latest"]).catch(() => null),
      ]);
      const decVal = decHex ? parseInt(decHex.replace("0x", ""), 16) : NaN;
      tokenInfo[addr] = { symbol: decodeAbiString(symHex) || "TOKEN", decimals: isNaN(decVal) ? 18 : decVal };
    }));

    for (const l of transferLogs) {
      const info = tokenInfo[l.address.toLowerCase()];
      const raw = BigInt(l.data?.length > 2 ? l.data : "0x0");
      all.push({
        from: "0x" + l.topics[1].slice(-40),
        to:   "0x" + l.topics[2].slice(-40),
        amount: Number(raw) / 10 ** info.decimals,
        asset: info.symbol,
      });
    }
  }

  if (!all.length) {
    return { network, hash, from: tx.from, to: tx.to, amount: 0, asset: nativeAsset(network) };
  }

  const first = all[0];
  return {
    network, hash,
    from: first.from, to: first.to, amount: first.amount, asset: first.asset,
    ...(all.length > 1 && { transfers: all }),
  };
}

async function evmTx(network, hash) {
  const chainid = EVM_CHAINS[network];
  if (!chainid) return null;
  // RPC is the primary path — returns native + all token transfers
  const result = await evmTxRpc(network, hash);
  if (result) return result;
  // RPC failed — Etherscan fallback (native value only, no token data)
  const KEY = evmKey();
  if (!KEY) return null;
  try {
    const url = `${EVM_BASE}?chainid=${chainid}&module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${KEY}`;
    const j = await fetchJsonRetry(url);
    const t = j.result;
    if (!t || !t.from) return null;
    const wei = BigInt(t.value ?? "0x0");
    return { network, hash, from: t.from, to: t.to, amount: Number(wei) / 1e18, asset: nativeAsset(network) };
  } catch { return null; }
}

async function tronTx(hash) {
  const headers = tronKey() ? { "TRON-PRO-API-KEY": tronKey() } : {};
  const r = await fetch(`${TRON_BASE}/transaction-info?hash=${hash}`, { headers });
  const j = await r.json();
  if (!j || (!j.ownerAddress && !j.contractData)) return null;
  const cd = j.contractData ?? {};
  const trc20s = j.trc20TransferInfo || [];

  if (trc20s.length > 1) {
    const transfers = trc20s.map((t) => ({
      from: t.from_address,
      to:   t.to_address,
      amount: Number(t.amount_str) / 10 ** Number(t.decimals || 6),
      asset: t.symbol || "TRC20",
    }));
    const first = transfers[0];
    return {
      network: "TRON", hash,
      from: j.ownerAddress || first.from, to: first.to,
      amount: first.amount, asset: first.asset,
      transfers,
    };
  }

  const trc20 = trc20s[0] || null;
  return {
    network: "TRON", hash,
    from: j.ownerAddress || cd.owner_address || trc20?.from_address || null,
    to: j.toAddress || cd.to_address || trc20?.to_address || null,
    amount: trc20
      ? Number(trc20.amount_str) / 10 ** Number(trc20.decimals || 6)
      : cd.amount ? Number(cd.amount) / 1e6 : undefined,
    asset: trc20?.symbol || "TRX",
  };
}

function nativeAsset(network) {
  return { ETH: "ETH", BSC: "BNB", POLYGON: "POL", ARBITRUM: "ETH", BASE: "ETH" }[network] || "";
}

async function solanaTx(hash) {
  const KEY = solscanKey();
  try {
    if (KEY) {
      const r = await fetch(`${SOLSCAN_PRO}/transaction/detail?tx=${hash}`, {
        headers: { token: KEY },
      });
      const j = await r.json();
      const d = j.data;
      if (!d) return null;
      const transfer = d.parsed_instructions?.[0];
      return {
        network: "SOLANA", hash,
        from: d.signer?.[0] || null,
        to: transfer?.params?.destination || null,
        amount: transfer?.params?.amount != null ? Number(transfer.params.amount) / 1e9 : undefined,
        asset: "SOL",
      };
    } else {
      const r = await fetch(`${SOLSCAN_PUBLIC}/transaction?signature=${hash}`);
      if (!r.ok) return null;
      const j = await r.json();
      return {
        network: "SOLANA", hash,
        from: j.signer?.[0] || null,
        to: null, amount: undefined, asset: "SOL",
      };
    }
  } catch { return null; }
}

export async function fetchTx(network, hash) {
  try {
    if (network === "TRON") return await tronTx(hash);
    if (network === "SOLANA") return await solanaTx(hash);
    return await evmTx(network, hash);
  } catch (e) {
    console.error(`[fetchTx] ${network} ${hash}: ${e?.message || e}`);
    return null;
  }
}

// --- address label lookup --------------------------------------------------

// Generic proxy pattern names that should never be returned as a final label —
// they describe the proxy infrastructure, not what the contract actually does.
const GENERIC_PROXY_NAMES = new Set([
  "TransparentUpgradeableProxy", "ERC1967Proxy", "BeaconProxy", "Proxy",
  "AdminUpgradeabilityProxy", "UpgradeableProxy", "InitializableAdminUpgradeabilityProxy",
  "UUPSUpgradeable", "TransparentProxy",
]);

// EIP-1967 implementation storage slot (standard across OZ TransparentUpgradeableProxy, UUPS, etc.)
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export async function fetchAddressLabel(network, address) {
  try {
    const chainid = EVM_CHAINS[network];
    if (chainid) {
      const KEY = evmKey();
      const rpc = PUBLIC_RPC[network];

      // Run headless browser scrape + Etherscan API lookup in parallel.
      // The browser scrape gets the exact curated name tag displayed on the explorer page.
      const [htmlLabel, apiLabel] = await Promise.all([
        fetchExplorerHtmlLabel(network, address).catch(() => null),
        (async () => {
          if (!KEY) return null;

          // Etherscan Pro name tag
          const tj = await fetchJsonRetry(
            `${EVM_BASE}?chainid=${chainid}&module=account&action=addresslabel&address=${address}&apikey=${KEY}`
          );
          if (tj.status === "1" && tj.result?.label) return tj.result.label;

          // Verified contract source name (skip generic proxy pattern names)
          const sj = await fetchJsonRetry(
            `${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${address}&apikey=${KEY}`
          );
          const cname = sj.result?.[0]?.ContractName;
          if (cname && cname.length > 0 && cname !== "0x") {
            if (!GENERIC_PROXY_NAMES.has(cname)) return cname;

            // For proxy contracts: read EIP-1967 impl slot and use the impl's contract name
            if (rpc) {
              const slotVal = await rpcPost(rpc, "eth_getStorageAt", [address, EIP1967_IMPL_SLOT, "latest"]).catch(() => null);
              if (slotVal && !/^0x0*$/.test(slotVal)) {
                const implAddr = "0x" + slotVal.slice(-40);
                const implSrc = await fetchJsonRetry(
                  `${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${implAddr}&apikey=${KEY}`
                ).catch(() => null);
                const implName = implSrc?.result?.[0]?.ContractName;
                if (implName && implName.length > 0 && !GENERIC_PROXY_NAMES.has(implName)) return implName;
              }
            }
          }
          return null;
        })().catch(() => null),
      ]);

      // HTML scrape gives the exact displayed label; API is fallback
      const evmLabel = htmlLabel || apiLabel;
      if (evmLabel) return { label: evmLabel };

      // RPC name() — catches ERC-20 / ERC-721 tokens (no key required)
      if (rpc) {
        const nameHex = await rpcPost(rpc, "eth_call", [{ to: address, data: "0x06fdde03" }, "latest"]).catch(() => null);
        const name = nameHex ? decodeAbiString(nameHex) : null;
        if (name) return { label: name };
      }
    }

    if (network === "TRON") {
      const headers = tronKey() ? { "TRON-PRO-API-KEY": tronKey() } : {};
      const r = await fetch(`${TRON_BASE}/account?address=${address}`, { headers });
      const j = await r.json();
      if (j.name) return { label: j.name };
    }

    if (network === "SOLANA") {
      const KEY = solscanKey();
      if (KEY) {
        const r = await fetch(`${SOLSCAN_PRO}/account/${address}`, { headers: { token: KEY } });
        const j = await r.json();
        const lbl = j.data?.label || j.data?.account_label?.label;
        if (lbl) return { label: lbl };
      }
    }
  } catch { /* best-effort */ }
  return { label: null };
}

// --- wallet transfer history (native + token) ------------------------------
// Each helper returns { transfers, diag } so the UI can show WHY a result is
// empty (bad key / rate limit / no activity) instead of a silent empty list.
async function evmWallet(network, address, { native, token, limit }) {
  const chainid = EVM_CHAINS[network];
  const KEY = evmKey();
  if (!chainid) return { transfers: [], diag: `unsupported EVM network: ${network}` };
  if (!KEY) return { transfers: [], diag: "ETHERSCAN_API_KEY не задан на сервере (server/.env)" };

  const out = [];
  let diag = null;
  const call = async (action) => {
    const url =
      `${EVM_BASE}?chainid=${chainid}&module=account&action=${action}` +
      `&address=${address}&page=1&offset=${limit}&sort=desc&apikey=${KEY}`;
    const j = await fetchJsonRetry(url);
    if (!Array.isArray(j.result)) {
      diag = [j.message, typeof j.result === "string" ? j.result : ""]
        .filter(Boolean).join(": ") || "unexpected response";
      console.warn(`[explorer] ${network}/${action} → ${diag}`);
      return [];
    }
    return j.result;
  };

  if (native) {
    for (const t of await call("txlist")) {
      out.push({
        network, hash: t.hash, from: t.from, to: t.to,
        amount: Number(BigInt(t.value || "0")) / 1e18,
        asset: nativeAsset(network),
        timestamp: Number(t.timeStamp) * 1000,
      });
    }
  }
  if (token) {
    for (const t of await call("tokentx")) {
      const dec = Number(t.tokenDecimal || 18);
      out.push({
        network, hash: t.hash, from: t.from, to: t.to,
        amount: Number(BigInt(t.value || "0")) / 10 ** dec,
        asset: t.tokenSymbol || "",
        timestamp: Number(t.timeStamp) * 1000,
      });
    }
  }
  return { transfers: out, diag: out.length ? null : diag };
}

async function tronWallet(address, { native, token, limit }) {
  const headers = tronKey() ? { "TRON-PRO-API-KEY": tronKey() } : {};
  const out = [];
  let diag = null;

  if (token) {
    const r = await fetch(
      `${TRON_BASE}/token_trc20/transfers?relatedAddress=${address}&limit=${limit}&start=0`,
      { headers }
    );
    const j = await r.json();
    if (j.message && !j.token_transfers) diag = String(j.message);
    for (const t of j.token_transfers || []) {
      const info = t.tokenInfo || {};
      const dec = Number(info.tokenDecimal || 6);
      out.push({
        network: "TRON", hash: t.transaction_id,
        from: t.from_address, to: t.to_address,
        amount: Number(t.quant) / 10 ** dec,
        asset: (info.tokenAbbr || "").toUpperCase(),
        timestamp: Number(t.block_ts),
      });
    }
  }
  if (native) {
    const r = await fetch(
      `${TRON_BASE}/transfer?sort=-timestamp&limit=${limit}&start=0&address=${address}`,
      { headers }
    );
    const j = await r.json();
    for (const t of j.data || []) {
      out.push({
        network: "TRON", hash: t.transactionHash || t.hash,
        from: t.transferFromAddress, to: t.transferToAddress,
        amount: Number(t.amount) / 1e6,
        asset: t.tokenName === "trx" ? "TRX" : t.tokenName || "TRX",
        timestamp: Number(t.timestamp),
      });
    }
  }
  return { transfers: out, diag: out.length ? null : diag };
}

async function solanaWallet(address, { native, token, limit }) {
  const KEY = solscanKey();
  const out = [];
  let diag = null;
  const NATIVE_ASSETS = new Set(["SOL"]);

  try {
    if (KEY) {
      const headers = { token: KEY };
      if (token) {
        const url = `${SOLSCAN_PRO}/account/transfer?address=${address}&page=1&page_size=${limit}&exclude_amount_zero=true&activity_type[]=ACTIVITY_SPL_TRANSFER`;
        const r = await fetch(url, { headers });
        const j = await r.json();
        for (const t of j.data || []) {
          const dec = Number(t.token_decimals || 0);
          const amount = Number(t.amount) / Math.pow(10, dec);
          if (!amount || isNaN(amount) || amount < 1) continue;
          out.push({
            network: "SOLANA", hash: t.trans_id,
            from: t.from_address, to: t.to_address,
            amount, asset: t.token_symbol || "SPL",
            timestamp: Number(t.block_time) * 1000,
          });
        }
      }
      if (native) {
        const url = `${SOLSCAN_PRO}/account/transfer?address=${address}&page=1&page_size=${limit}&exclude_amount_zero=true&activity_type[]=ACTIVITY_SOL_TRANSFER`;
        const r = await fetch(url, { headers });
        const j = await r.json();
        for (const t of j.data || []) {
          out.push({
            network: "SOLANA", hash: t.trans_id,
            from: t.from_address, to: t.to_address,
            amount: Number(t.amount) / 1e9, asset: "SOL",
            timestamp: Number(t.block_time) * 1000,
          });
        }
      }
    } else {
      // Public API (no key)
      if (token) {
        const r = await fetch(`${SOLSCAN_PUBLIC}/account/splTransfers?account=${address}&limit=${limit}`);
        if (!r.ok) {
          diag = `Solscan HTTP ${r.status} — установите SOLSCAN_API_KEY в server/.env`;
        } else {
          const j = await r.json();
          for (const t of j.data || []) {
            const dec = Number(t.decimals || 0);
            const amount = Number(t.changeAmount || 0) / Math.pow(10, dec);
            if (!amount || isNaN(amount) || amount < 1) continue;
            out.push({
              network: "SOLANA", hash: t.txHash,
              from: t.src, to: t.dst,
              amount, asset: t.symbol || "SPL",
              timestamp: Number(t.blockTime) * 1000,
            });
          }
        }
      }
      if (native) {
        const r = await fetch(`${SOLSCAN_PUBLIC}/account/transactions?account=${address}&limit=${limit}`);
        if (r.ok) {
          const j = await r.json();
          for (const t of j || []) {
            out.push({
              network: "SOLANA", hash: t.txHash,
              from: t.signer?.[0] || null, to: null,
              amount: undefined, asset: "SOL",
              timestamp: Number(t.blockTime) * 1000,
            });
          }
        }
      }
      if (!out.length && !diag)
        diag = "Нет данных (для токен-трансферов установите SOLSCAN_API_KEY в server/.env)";
    }
  } catch (e) {
    diag = String(e?.message || e);
  }

  return { transfers: out, diag: out.length ? null : diag, _nativeAssets: NATIVE_ASSETS };
}

const NATIVE_ASSETS = new Set(["ETH", "BNB", "POL", "TRX", "SOL"]);

export async function fetchWalletTransfers(network, address, opts) {
  const o = { native: true, token: true, limit: 50, ...opts };
  o.limit = Math.min(Math.max(Number(o.limit) || 50, 1), 200);
  try {
    const res = network === "TRON"
      ? await tronWallet(address, o)
      : network === "SOLANA"
      ? await solanaWallet(address, o)
      : await evmWallet(network, address, o);
    const transfers = res.transfers
      .filter((t) => t.hash && (t.from || t.to))
      // Drop token transfers (not native coins) where amount is N/A or < 1
      .filter((t) => {
        if (NATIVE_ASSETS.has(t.asset || "")) return true;
        return t.amount != null && !isNaN(t.amount) && t.amount >= 1;
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, o.limit);
    return { transfers, diag: transfers.length ? null : res.diag };
  } catch (e) {
    return { transfers: [], diag: String(e?.message || e) };
  }
}
