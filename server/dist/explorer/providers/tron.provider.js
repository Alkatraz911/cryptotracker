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
var TronProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TronProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const TRON_BASE = 'https://apilist.tronscanapi.com/api';
let TronProvider = TronProvider_1 = class TronProvider {
    constructor(cfg) {
        this.logger = new common_1.Logger(TronProvider_1.name);
        this.accountCache = new Map();
        this.key = () => cfg.get('TRONSCAN_API_KEY', '');
    }
    headers() {
        const k = this.key();
        return k ? { 'TRON-PRO-API-KEY': k } : {};
    }
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    async fetchJson(url, tries = 4) {
        let last = {};
        for (let i = 0; i < tries; i++) {
            try {
                const r = await fetch(url, { headers: this.headers() });
                if (r.status === 429 || r.status === 403 || r.status >= 500) {
                    await this.sleep(500 * (i + 1));
                    continue;
                }
                const j = await r.json();
                last = j;
                const msg = String(j['message'] ?? j['Error'] ?? j['error'] ?? '');
                if (/rate|limit|frequenc|too many|forbidden/i.test(msg)) {
                    await this.sleep(500 * (i + 1));
                    continue;
                }
                return j;
            }
            catch (e) {
                this.logger.warn(`[TRON] ${url.split('?')[0]} retry ${i + 1}: ${e?.message}`);
                await this.sleep(400 * (i + 1));
            }
        }
        return last;
    }
    async getAccount(address) {
        const c = this.accountCache.get(address);
        if (c && Date.now() - c.at < TronProvider_1.ACCOUNT_TTL)
            return c.data;
        const data = await this.fetchJson(`${TRON_BASE}/account?address=${address}`);
        this.accountCache.set(address, { data, at: Date.now() });
        return data;
    }
    async fetchTx(hash) {
        for (let i = 0; i < 3; i++) {
            const j = await this.fetchJson(`${TRON_BASE}/transaction-info?hash=${hash}`);
            if (j['ownerAddress'] || j['contractData'] || j['trc20TransferInfo']?.length) {
                return this.parseTx(hash, j);
            }
            await this.sleep(500 * (i + 1));
        }
        return null;
    }
    parseTx(hash, j) {
        const cd = (j['contractData'] ?? {});
        const trc20s = (j['trc20TransferInfo'] || []);
        const timestamp = j['timestamp'] ? Number(j['timestamp']) : undefined;
        if (trc20s.length > 1) {
            const transfers = trc20s.map((t) => ({
                network: 'TRON', hash,
                from: t['from_address'],
                to: t['to_address'],
                amount: Number(t['amount_str']) / 10 ** Number(t['decimals'] || 6),
                asset: (t['symbol'] || 'TRC20'),
            }));
            const first = transfers[0];
            return { network: 'TRON', hash, from: j['ownerAddress'] || first.from, to: first.to, amount: first.amount, asset: first.asset, timestamp, transfers };
        }
        const trc20 = trc20s[0] || null;
        return {
            network: 'TRON', hash,
            from: (trc20?.['from_address'] || j['ownerAddress'] || cd['owner_address'] || null),
            to: (trc20?.['to_address'] || j['toAddress'] || cd['to_address'] || null),
            amount: trc20 ? Number(trc20['amount_str']) / 10 ** Number(trc20['decimals'] || 6) : cd['amount'] ? Number(cd['amount']) / 1e6 : undefined,
            asset: (trc20?.['symbol'] || 'TRX'),
            timestamp,
        };
    }
    async fetchAddressLabel(address) {
        const j = await this.getAccount(address);
        const raw = (j['addressTag'] || j['publicTag'] || j['name'] || '');
        const label = String(raw).trim();
        return { label: label || null };
    }
    async fetchBalance(address) {
        try {
            const j = await this.getAccount(address);
            const bal = j['balance'];
            if (bal == null)
                return { amount: null, asset: 'TRX', diag: 'TronScan: баланс недоступен' };
            return { amount: Number(bal) / 1e6, asset: 'TRX', diag: null };
        }
        catch (e) {
            return { amount: null, asset: 'TRX', diag: String(e?.message || e) };
        }
    }
    async fetchTokenBalances(address) {
        try {
            const j = await this.getAccount(address);
            const list = (j['trc20token_balances'] || j['withPriceTokens'] || []);
            const out = [];
            for (const t of list) {
                const dec = Number(t['tokenDecimal'] ?? 6);
                const amount = Number(t['balance'] ?? 0) / 10 ** dec;
                const sym = (t['tokenAbbr'] || t['tokenName'] || 'TRC20').toUpperCase();
                if (amount > 0)
                    out.push({ asset: sym, amount });
            }
            return out.slice(0, 25);
        }
        catch {
            return [];
        }
    }
    async fetchWalletTransfers(address, opts) {
        const out = [];
        let diag = null;
        const PAGE = 50;
        const paginate = async (build, rowsKey, onRows) => {
            let got = 0;
            for (let start = 0; got < opts.limit && start < opts.limit; start += PAGE) {
                const lim = Math.min(PAGE, opts.limit - got);
                const j = await this.fetchJson(build(start, lim));
                if (j['message'] && !j[rowsKey]) {
                    diag = String(j['message']);
                    break;
                }
                const rows = (j[rowsKey] || []);
                if (!rows.length)
                    break;
                onRows(rows);
                got += rows.length;
                if (rows.length < lim)
                    break;
            }
        };
        if (opts.token) {
            await paginate((start, lim) => `${TRON_BASE}/token_trc20/transfers?relatedAddress=${address}&limit=${lim}&start=${start}`, 'token_transfers', (rows) => rows.forEach((t) => {
                const info = (t['tokenInfo'] || {});
                const dec = Number(info['tokenDecimal'] || 6);
                out.push({ network: 'TRON', hash: t['transaction_id'], from: t['from_address'], to: t['to_address'], amount: Number(t['quant']) / 10 ** dec, asset: (info['tokenAbbr'] || '').toUpperCase(), timestamp: Number(t['block_ts']) });
            }));
        }
        if (opts.native) {
            await paginate((start, lim) => `${TRON_BASE}/transfer?sort=-timestamp&limit=${lim}&start=${start}&address=${address}`, 'data', (rows) => rows.forEach((t) => {
                const info = (t['tokenInfo'] || {});
                const dec = Number(info['tokenDecimal'] ?? 6);
                const abbr = String(info['tokenAbbr'] || t['tokenName'] || 'TRX');
                const asset = abbr.toLowerCase() === 'trx' || abbr === '_' ? 'TRX' : abbr.toUpperCase();
                out.push({
                    network: 'TRON',
                    hash: (t['transactionHash'] || t['hash']),
                    from: t['transferFromAddress'],
                    to: t['transferToAddress'],
                    amount: Number(t['amount']) / 10 ** dec,
                    asset,
                    timestamp: Number(t['timestamp']),
                });
            }));
        }
        return { transfers: out, diag: out.length ? null : diag };
    }
};
exports.TronProvider = TronProvider;
TronProvider.ACCOUNT_TTL = 15000;
exports.TronProvider = TronProvider = TronProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TronProvider);
//# sourceMappingURL=tron.provider.js.map