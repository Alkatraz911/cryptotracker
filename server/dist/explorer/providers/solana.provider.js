"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SolanaProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const SOLSCAN_PRO = 'https://pro-api.solscan.io/v2.0';
const SOLSCAN_LEGACY = 'https://public-api.solscan.io';
const SOLANA_RPCS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com',
];
const MINT_SYMBOLS = {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
    So11111111111111111111111111111111111111112: 'SOL',
};
let SolanaProvider = SolanaProvider_1 = class SolanaProvider {
    constructor(cfg) {
        this.logger = new common_1.Logger(SolanaProvider_1.name);
        this.key = () => cfg.get('SOLSCAN_API_KEY', '');
        this.heliusKey = () => cfg.get('HELIUS_API_KEY', '');
    }
    rpcEndpoints() {
        const h = this.heliusKey();
        return h ? [`https://mainnet.helius-rpc.com/?api-key=${h}`, ...SOLANA_RPCS] : [...SOLANA_RPCS];
    }
    async fetchTx(hash) {
        const KEY = this.key();
        try {
            if (KEY) {
                const pro = await this.fetchTxPro(hash, KEY);
                if (pro)
                    return pro;
                this.logger.warn(`fetchTxPro returned null for ${hash.slice(0, 20)}… — falling back to RPC`);
            }
            for (const rpc of this.rpcEndpoints()) {
                const r = await this.fetchTxRpc(rpc, hash);
                if (r)
                    return r;
            }
            return await this.fetchTxLegacy(hash);
        }
        catch (e) {
            this.logger.error(`fetchTx ${hash}: ${e?.message}`);
            return null;
        }
    }
    async fetchTxPro(hash, key) {
        const r = await fetch(`${SOLSCAN_PRO}/transaction/detail?tx=${hash}`, {
            headers: { token: key },
        });
        if (!r.ok) {
            this.logger.warn(`[SolscanPro] HTTP ${r.status} for tx ${hash.slice(0, 20)}…`);
            return null;
        }
        const j = await r.json();
        const d = j['data'];
        if (!d) {
            this.logger.warn(`[SolscanPro] data=null, success=${j['success']}`);
            return null;
        }
        const instr = d['parsed_instructions']?.[0];
        const params = instr?.['params'];
        return {
            network: 'SOLANA', hash,
            from: d['signer']?.[0] ?? null,
            to: params?.['destination'] ?? null,
            amount: params?.['amount'] != null ? Number(params['amount']) / 1e9 : undefined,
            asset: 'SOL',
        };
    }
    async fetchTxRpc(rpc, hash) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15000);
        try {
            this.logger.log(`[RPC] → ${rpc.replace('https://', '')}`);
            const r = await fetch(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 1,
                    method: 'getTransaction',
                    params: [hash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
                }),
                signal: ac.signal,
            });
            this.logger.log(`[RPC] ← HTTP ${r.status}`);
            if (!r.ok) {
                this.logger.warn(`[RPC] non-OK HTTP ${r.status} from ${rpc}`);
                return null;
            }
            const j = await r.json();
            if (j['error']) {
                this.logger.warn(`[RPC] JSON-RPC error: ${JSON.stringify(j['error'])}`);
                return null;
            }
            const tx = j['result'];
            if (!tx) {
                this.logger.warn(`[RPC] result=null — tx not found or not confirmed`);
                return null;
            }
            const item = this.parseRpcTx(hash, tx);
            const bt = tx['blockTime'];
            if (bt)
                item.timestamp = Number(bt) * 1000;
            this.logger.log(`[RPC] OK — from=${item.from?.slice(0, 12)}… to=${item.to?.slice(0, 12) ?? 'null'} asset=${item.asset}`);
            return item;
        }
        catch (e) {
            this.logger.error(`[RPC] exception: ${e?.message}`);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    parseRpcTx(hash, tx) {
        const msg = tx['transaction']?.['message'];
        const keys = (msg?.['accountKeys'] ?? []);
        const defaultFrom = keys[0]?.pubkey ?? null;
        const topLevel = (msg?.['instructions'] ?? []);
        const innerGroups = (tx['meta']?.['innerInstructions'] ?? []);
        const allIx = [...topLevel, ...innerGroups.flatMap((g) => g.instructions)];
        for (const ix of allIx) {
            const parsed = ix['parsed'];
            const info = parsed?.['info'];
            if (!parsed || !info)
                continue;
            if (ix['program'] === 'system' && parsed['type'] === 'transfer') {
                return {
                    network: 'SOLANA', hash,
                    from: info['source'] || defaultFrom,
                    to: info['destination'] || null,
                    amount: Number(info['lamports']) / 1e9,
                    asset: 'SOL',
                };
            }
            if (ix['program'] === 'spl-token' &&
                (parsed['type'] === 'transferChecked' || parsed['type'] === 'transfer')) {
                const ta = info['tokenAmount'];
                const amount = ta?.['uiAmount'] != null
                    ? Number(ta['uiAmount'])
                    : undefined;
                return {
                    network: 'SOLANA', hash,
                    from: info['authority'] || info['source'] || defaultFrom,
                    to: info['destination'] || null,
                    amount,
                    asset: 'SPL',
                };
            }
        }
        return { network: 'SOLANA', hash, from: defaultFrom, to: null, amount: undefined, asset: 'SOL' };
    }
    async fetchTxLegacy(hash) {
        try {
            const r = await fetch(`${SOLSCAN_LEGACY}/transaction?signature=${hash}`);
            if (!r.ok)
                return null;
            const j = await r.json();
            const from = j['signer']?.[0] ?? null;
            if (!from)
                return null;
            return { network: 'SOLANA', hash, from, to: null, amount: undefined, asset: 'SOL' };
        }
        catch {
            return null;
        }
    }
    async fetchAddressLabel(address) {
        const okx = await this.fetchOkxLabel(address);
        if (okx)
            return { label: okx };
        const KEY = this.key();
        if (KEY) {
            try {
                const r = await fetch(`${SOLSCAN_PRO}/account/detail?address=${address}`, { headers: { token: KEY } });
                if (r.ok) {
                    const j = await r.json();
                    const data = j['data'];
                    const lbl = data?.['label'] ?? data?.['account_label']?.['label'];
                    if (lbl)
                        return { label: lbl };
                }
            }
            catch { }
        }
        return { label: null };
    }
    async fetchOkxLabel(address) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        try {
            const r = await fetch(`https://web3.okx.com/explorer/sol/account/${address}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                signal: ac.signal,
            });
            if (!r.ok)
                return null;
            const html = await r.text();
            const m1 = html.match(/"hoverEntityTag"\s*:\s*"([^"]{2,100})"/);
            if (m1?.[1])
                return m1[1];
            const m2 = html.match(/"entityTag"\s*:\s*"([^"]{2,100})"/);
            if (m2?.[1])
                return m2[1];
            return null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async fetchWalletTransfers(address, opts) {
        if (this.heliusKey()) {
            const h = await this.fetchWalletTransfersHelius(address, opts);
            if (h.transfers.length)
                return h;
            this.logger.warn(`Helius returned no transfers (${h.diag ?? 'empty'}) — trying other sources`);
        }
        const KEY = this.key();
        if (KEY) {
            const pro = await this.fetchWalletTransfersPro(address, opts, KEY);
            if (pro.transfers.length)
                return pro;
            this.logger.warn('Solscan Pro returned no wallet data (free-tier key blocks it) — falling back to public RPC');
        }
        return this.fetchWalletTransfersRpc(address, opts);
    }
    async fetchWalletTransfersHelius(address, opts) {
        const KEY = this.heliusKey();
        const want = Math.max(opts.limit, 1);
        const out = [];
        let before = '';
        let txCount = 0;
        let diag = null;
        for (let page = 0; page < 30 && out.length < want; page++) {
            const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ''}`;
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 15000);
            let arr;
            try {
                const r = await fetch(url, { signal: ac.signal });
                if (!r.ok) {
                    diag = `Helius HTTP ${r.status}`;
                    break;
                }
                arr = await r.json();
            }
            catch (e) {
                diag = `Helius: ${e?.message}`;
                break;
            }
            finally {
                clearTimeout(timer);
            }
            if (!Array.isArray(arr) || !arr.length)
                break;
            txCount += arr.length;
            for (const tx of arr) {
                const sig = tx['signature'];
                const ts = tx['timestamp'] ? Number(tx['timestamp']) * 1000 : undefined;
                if (opts.native) {
                    for (const n of (tx['nativeTransfers'] ?? [])) {
                        const amount = Number(n['amount']) / 1e9;
                        if (!amount)
                            continue;
                        out.push({
                            network: 'SOLANA', hash: sig,
                            from: n['fromUserAccount'] || null, to: n['toUserAccount'] || null,
                            amount, asset: 'SOL', timestamp: ts,
                        });
                    }
                }
                if (opts.token) {
                    for (const t of (tx['tokenTransfers'] ?? [])) {
                        const amount = Number(t['tokenAmount']) || 0;
                        out.push({
                            network: 'SOLANA', hash: sig,
                            from: t['fromUserAccount'] || null, to: t['toUserAccount'] || null,
                            amount, asset: MINT_SYMBOLS[t['mint']] || 'SPL', timestamp: ts,
                        });
                    }
                }
            }
            before = arr[arr.length - 1]['signature'];
            if (arr.length < 100)
                break;
        }
        this.logger.log(`[Helius] wallet ${address.slice(0, 8)}…: ${txCount} txs → ${out.length} transfers`);
        return { transfers: out, diag: out.length ? null : (diag ?? 'Helius: переводы не найдены') };
    }
    async fetchWalletTransfersPro(address, opts, KEY) {
        const PS = [10, 20, 30, 40, 60, 100];
        const pageSize = PS.find((p) => p >= opts.limit) ?? 100;
        const out = [];
        let diag = null;
        const headers = { token: KEY };
        const pull = async (activity, native) => {
            const r = await fetch(`${SOLSCAN_PRO}/account/transfer?address=${address}&page=1&page_size=${pageSize}` +
                `&exclude_amount_zero=true&activity_type[]=${activity}`, { headers });
            const j = await r.json();
            if (!r.ok || j['success'] === false) {
                diag = `Solscan: ${j['errors']?.['message'] ?? `HTTP ${r.status}`}`;
                return;
            }
            for (const t of (j['data'] ?? [])) {
                const dec = native ? 9 : Number(t['token_decimals'] || 0);
                const amount = Number(t['amount']) / Math.pow(10, dec);
                out.push({
                    network: 'SOLANA', hash: t['trans_id'],
                    from: t['from_address'], to: t['to_address'],
                    amount, asset: native ? 'SOL' : (t['token_symbol'] || 'SPL'),
                    timestamp: Number(t['block_time']) * 1000,
                });
            }
        };
        try {
            if (opts.token)
                await pull('ACTIVITY_SPL_TRANSFER', false);
            if (opts.native)
                await pull('ACTIVITY_SOL_TRANSFER', true);
        }
        catch (e) {
            diag = String(e?.message || e);
        }
        return { transfers: out, diag: out.length ? null : diag };
    }
    async fetchBalance(address) {
        for (const rpc of this.rpcEndpoints()) {
            const res = await this.rpcCall(rpc, 'getBalance', [address]);
            if (res == null)
                continue;
            const lamports = typeof res === 'object' && res !== null && 'value' in res
                ? Number(res['value'])
                : Number(res);
            if (!Number.isNaN(lamports))
                return { amount: lamports / 1e9, asset: 'SOL', diag: null };
        }
        return { amount: null, asset: 'SOL', diag: 'SOLANA: публичный RPC недоступен (getBalance).' };
    }
    async fetchTokenBalances(address) {
        const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
        for (const rpc of this.rpcEndpoints()) {
            const res = await this.rpcCall(rpc, 'getTokenAccountsByOwner', [address, { programId: SPL_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]);
            const value = res?.['value'];
            if (!Array.isArray(value))
                continue;
            const out = [];
            for (const acc of value) {
                const data = acc['account']?.['data'];
                const info = (data?.['parsed']?.['info']);
                const mint = info?.['mint'];
                const ta = info?.['tokenAmount'];
                const amount = ta?.['uiAmount'] != null ? Number(ta['uiAmount']) : 0;
                if (amount > 0 && mint)
                    out.push({ asset: MINT_SYMBOLS[mint] || `${mint.slice(0, 4)}…${mint.slice(-4)}`, amount });
            }
            return out.slice(0, 25);
        }
        return [];
    }
    async rpcCall(rpc, method, params) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15000);
        try {
            const r = await fetch(rpc, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: ac.signal,
            });
            if (!r.ok)
                return null;
            const j = await r.json();
            return j.error ? null : (j.result ?? null);
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async fetchWalletTransfersRpc(address, opts) {
        const limit = Math.min(opts.limit, 40);
        let sigs = null;
        let rpc = '';
        for (const candidate of this.rpcEndpoints()) {
            const r = await this.rpcCall(candidate, 'getSignaturesForAddress', [address, { limit }]);
            if (Array.isArray(r)) {
                sigs = r;
                rpc = candidate;
                break;
            }
        }
        if (!sigs)
            return { transfers: [], diag: 'SOLANA: публичный RPC недоступен (getSignaturesForAddress).' };
        if (!sigs.length)
            return { transfers: [], diag: 'SOLANA: транзакции для адреса не найдены.' };
        this.logger.log(`[RPC] wallet ${address.slice(0, 8)}…: ${sigs.length} signatures via ${rpc.replace('https://', '')}`);
        const out = [];
        const POOL = 4;
        for (let i = 0; i < sigs.length; i += POOL) {
            const batch = sigs.slice(i, i + POOL);
            const items = await Promise.all(batch.map(async (s) => {
                const tx = await this.rpcCall(rpc, 'getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
                if (!tx)
                    return null;
                const item = this.parseRpcTx(s.signature, tx);
                const bt = tx['blockTime'] ?? s.blockTime;
                item.timestamp = bt ? Number(bt) * 1000 : undefined;
                return item;
            }));
            for (const it of items) {
                if (!it || (!it.from && !it.to))
                    continue;
                const isNative = it.asset === 'SOL';
                if (isNative && !opts.native)
                    continue;
                if (!isNative && !opts.token)
                    continue;
                out.push(it);
            }
        }
        return { transfers: out, diag: out.length ? null : 'SOLANA: переводы не распознаны в транзакциях кошелька.' };
    }
};
exports.SolanaProvider = SolanaProvider;
exports.SolanaProvider = SolanaProvider = SolanaProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SolanaProvider);
//# sourceMappingURL=solana.provider.js.map