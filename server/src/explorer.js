// Server-side explorer enrichment (no browser CORS, API key stays here).
// Best-effort: returns null on any failure so the client can fall back to
// the values parsed from the URL.

const EVM_CHAINS = { ETH: 1, BSC: 56, POLYGON: 137, ARBITRUM: 42161, BASE: 8453 };
const EVM_BASE = "https://api.etherscan.io/v2/api";
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

async function evmTx(network, hash) {
  const chainid = EVM_CHAINS[network];
  const KEY = evmKey();
  if (!chainid || !KEY) return null;
  const url =
    `${EVM_BASE}?chainid=${chainid}&module=proxy&action=eth_getTransactionByHash` +
    `&txhash=${hash}&apikey=${KEY}`;
  const j = await fetchJsonRetry(url);
  const t = j.result;
  if (!t || !t.from) return null;
  const wei = BigInt(t.value ?? "0x0");
  return {
    network,
    hash,
    from: t.from,
    to: t.to,
    amount: Number(wei) / 1e18,
    asset: nativeAsset(network),
  };
}

async function tronTx(hash) {
  const headers = tronKey() ? { "TRON-PRO-API-KEY": tronKey() } : {};
  const r = await fetch(`${TRON_BASE}/transaction-info?hash=${hash}`, { headers });
  const j = await r.json();
  if (!j || (!j.ownerAddress && !j.contractData)) return null;
  const cd = j.contractData ?? {};
  const trc20 = (j.trc20TransferInfo && j.trc20TransferInfo[0]) || null;
  return {
    network: "TRON",
    hash,
    from: j.ownerAddress || cd.owner_address || trc20?.from_address || null,
    to: j.toAddress || cd.to_address || trc20?.to_address || null,
    amount: trc20
      ? Number(trc20.amount_str) / 10 ** Number(trc20.decimals || 6)
      : cd.amount
      ? Number(cd.amount) / 1e6
      : undefined,
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
  } catch {
    return null;
  }
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
