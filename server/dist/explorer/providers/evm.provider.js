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
var EvmProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvmProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const OKX_CHAINS = {
    ETH: 'eth', BSC: 'bsc', POLYGON: 'polygon',
    ARBITRUM: 'arbitrum-one', BASE: 'base',
};
const EVM_CHAINS = {
    ETH: 1, BSC: 56, POLYGON: 137, ARBITRUM: 42161, BASE: 8453,
};
const EVM_BASE = 'https://api.etherscan.io/v2/api';
const SCAN_HOSTS = {
    BSC: 'https://bscscan.com',
    BASE: 'https://basescan.org',
};
const PUBLIC_RPC = {
    ETH: 'https://eth.llamarpc.com',
    BSC: 'https://bsc-dataseed.binance.org',
    POLYGON: 'https://polygon-rpc.com',
    ARBITRUM: 'https://arb1.arbitrum.io/rpc',
    BASE: 'https://mainnet.base.org',
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const GENERIC_PROXY_NAMES = new Set([
    'TransparentUpgradeableProxy', 'ERC1967Proxy', 'BeaconProxy', 'Proxy',
    'AdminUpgradeabilityProxy', 'UpgradeableProxy', 'InitializableAdminUpgradeabilityProxy',
    'UUPSUpgradeable', 'TransparentProxy',
]);
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
let EvmProvider = EvmProvider_1 = class EvmProvider {
    constructor(cfg) {
        this.logger = new common_1.Logger(EvmProvider_1.name);
        this.key = () => cfg.get('ETHERSCAN_API_KEY', '');
    }
    nativeAsset(network) {
        return { ETH: 'ETH', BSC: 'BNB', POLYGON: 'POL', ARBITRUM: 'ETH', BASE: 'ETH' }[network] || '';
    }
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    async rpcPost(rpc, method, params) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        try {
            const r = await fetch(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: ac.signal,
            });
            const j = await r.json();
            if (j.error)
                throw new Error(j.error.message || JSON.stringify(j.error));
            return j.result ?? null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    decodeAbiString(hex) {
        if (!hex || hex === '0x')
            return null;
        const h = hex.startsWith('0x') ? hex.slice(2) : hex;
        if (h.length < 128) {
            const s = Buffer.from(h.padEnd(64, '0'), 'hex').toString('utf8').replace(/\0/g, '').trim();
            return s.length && s.length <= 32 ? s : null;
        }
        const len = parseInt(h.slice(64, 128), 16);
        if (!len || len > 200)
            return null;
        try {
            return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0/g, '').trim() || null;
        }
        catch {
            return null;
        }
    }
    async fetchJsonRetry(url, tries = 4) {
        let last = {};
        for (let i = 0; i < tries; i++) {
            const r = await fetch(url);
            const j = await r.json();
            last = j;
            const note = `${j['message'] ?? ''} ${typeof j['result'] === 'string' ? j['result'] : ''}`;
            if (/rate limit/i.test(note)) {
                await this.sleep(300 * (i + 1));
                continue;
            }
            return j;
        }
        return last;
    }
    async fetchExplorerHtmlLabel(network, address) {
        const chain = OKX_CHAINS[network];
        if (!chain)
            return null;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        try {
            const r = await fetch(`https://web3.okx.com/explorer/${chain}/address/${address}`, {
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
    async evmTxRpc(network, hash) {
        const rpc = PUBLIC_RPC[network];
        if (!rpc)
            return null;
        let tx;
        try {
            tx = await this.rpcPost(rpc, 'eth_getTransactionByHash', [hash]);
        }
        catch (e) {
            this.logger.error(`[evmTxRpc] ${network} RPC error: ${e.message}`);
            return null;
        }
        if (!tx || !tx['from']) {
            this.logger.warn(`[evmTxRpc] ${network} tx not found: ${hash}`);
            return null;
        }
        const nativeValue = BigInt(tx['value'] ?? '0x0');
        let timestamp;
        const blockNum = tx['blockNumber'];
        if (blockNum) {
            const block = await this.rpcPost(rpc, 'eth_getBlockByNumber', [blockNum, false]).catch(() => null);
            const tsHex = block?.['timestamp'];
            if (tsHex)
                timestamp = Number(BigInt(tsHex)) * 1000;
        }
        const receipt = await this.rpcPost(rpc, 'eth_getTransactionReceipt', [hash]).catch(() => null);
        const logs = (receipt?.['logs'] ?? []);
        const transferLogs = logs.filter((l) => l['topics']?.[0]?.toLowerCase() === TRANSFER_TOPIC && l['topics'].length >= 3);
        const all = [];
        if (nativeValue > 0n) {
            all.push({ from: tx['from'], to: tx['to'], amount: Number(nativeValue) / 1e18, asset: this.nativeAsset(network) });
        }
        if (transferLogs.length > 0) {
            const contracts = [...new Set(transferLogs.map((l) => l['address'].toLowerCase()))];
            const tokenInfo = {};
            await Promise.all(contracts.map(async (addr) => {
                const [symHex, decHex] = await Promise.all([
                    this.rpcPost(rpc, 'eth_call', [{ to: addr, data: '0x95d89b41' }, 'latest']).catch(() => null),
                    this.rpcPost(rpc, 'eth_call', [{ to: addr, data: '0x313ce567' }, 'latest']).catch(() => null),
                ]);
                const decVal = decHex ? parseInt(decHex.replace('0x', ''), 16) : NaN;
                tokenInfo[addr] = { symbol: this.decodeAbiString(symHex) || 'TOKEN', decimals: isNaN(decVal) ? 18 : decVal };
            }));
            for (const l of transferLogs) {
                const info = tokenInfo[l['address'].toLowerCase()];
                const raw = BigInt(l['data']?.length > 2 ? l['data'] : '0x0');
                const topics = l['topics'];
                all.push({ from: '0x' + topics[1].slice(-40), to: '0x' + topics[2].slice(-40), amount: Number(raw) / 10 ** info.decimals, asset: info.symbol });
            }
        }
        if (!all.length)
            return { network, hash, from: tx['from'], to: tx['to'], amount: 0, asset: this.nativeAsset(network), timestamp };
        const first = all[0];
        return { network, hash, from: first.from, to: first.to, amount: first.amount, asset: first.asset, timestamp, ...(all.length > 1 && { transfers: all }) };
    }
    async fetchTx(network, hash) {
        const chainid = EVM_CHAINS[network];
        if (!chainid)
            return null;
        const result = await this.evmTxRpc(network, hash);
        if (result)
            return result;
        const KEY = this.key();
        if (!KEY)
            return null;
        try {
            const url = `${EVM_BASE}?chainid=${chainid}&module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${KEY}`;
            const j = await this.fetchJsonRetry(url);
            const t = j['result'];
            if (!t || !t['from'])
                return null;
            const wei = BigInt(t['value'] ?? '0x0');
            return { network, hash, from: t['from'], to: t['to'], amount: Number(wei) / 1e18, asset: this.nativeAsset(network) };
        }
        catch {
            return null;
        }
    }
    async fetchAddressLabel(network, address) {
        const chainid = EVM_CHAINS[network];
        if (!chainid)
            return { label: null };
        const KEY = this.key();
        const rpc = PUBLIC_RPC[network];
        const [htmlLabel, apiLabel] = await Promise.all([
            this.fetchExplorerHtmlLabel(network, address).catch(() => null),
            (async () => {
                if (!KEY)
                    return null;
                const tj = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=account&action=addresslabel&address=${address}&apikey=${KEY}`);
                const tjResult = tj['result'];
                if (tj['status'] === '1' && tjResult?.['label'])
                    return tjResult['label'];
                const sj = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${address}&apikey=${KEY}`);
                const cname = sj['result']?.[0]?.['ContractName'];
                if (cname && cname.length > 0 && cname !== '0x') {
                    if (!GENERIC_PROXY_NAMES.has(cname))
                        return cname;
                    if (rpc) {
                        const slotVal = await this.rpcPost(rpc, 'eth_getStorageAt', [address, EIP1967_IMPL_SLOT, 'latest']).catch(() => null);
                        if (slotVal && !/^0x0*$/.test(slotVal)) {
                            const implAddr = '0x' + slotVal.slice(-40);
                            const implSrc = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${implAddr}&apikey=${KEY}`).catch(() => null);
                            const implName = implSrc?.['result']?.[0]?.['ContractName'];
                            if (implName && implName.length > 0 && !GENERIC_PROXY_NAMES.has(implName))
                                return implName;
                        }
                    }
                }
                return null;
            })().catch(() => null),
        ]);
        const evmLabel = htmlLabel || apiLabel;
        if (evmLabel)
            return { label: evmLabel };
        if (rpc) {
            const nameHex = await this.rpcPost(rpc, 'eth_call', [{ to: address, data: '0x06fdde03' }, 'latest']).catch(() => null);
            const name = nameHex ? this.decodeAbiString(nameHex) : null;
            if (name)
                return { label: name };
        }
        return { label: null };
    }
    async fetchScanPage(url, scanBase) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15000);
        try {
            const r = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0',
                    'Accept': 'text/html,*/*;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': scanBase + '/',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                signal: ac.signal,
            });
            if (!r.ok) {
                this.logger.warn(`[Scan] HTTP ${r.status} for ${url}`);
                return null;
            }
            return r.text();
        }
        catch (e) {
            this.logger.error(`[Scan] ${e.message}`);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    parseScanAmount(s) {
        const m = s.replace(/,/g, '').match(/-?\d*\.?\d+/);
        return m ? parseFloat(m[0]) : 0;
    }
    parseScanUsd(s) {
        const m = s.replace(/,/g, '').match(/\$\s*(-?\d*\.?\d+)\s*([KMB])?/i);
        if (!m)
            return 0;
        let v = parseFloat(m[1]);
        const suf = (m[2] || '').toUpperCase();
        if (suf === 'K')
            v *= 1e3;
        else if (suf === 'M')
            v *= 1e6;
        else if (suf === 'B')
            v *= 1e9;
        return v;
    }
    parseScanRows(html, network, type) {
        const out = [];
        const body = html.includes('<tbody') ? html.split('<tbody')[1] : html;
        for (const [, rowHtml] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            if (/<th[\s>]/i.test(rowHtml))
                continue;
            const hashM = rowHtml.match(/href="\/tx\/(0x[0-9a-fA-F]{64})"/i);
            if (!hashM)
                continue;
            const hash = hashM[1];
            const fromM = rowHtml.match(/data-clipboard-text='(0x[0-9a-fA-F]{40})'(?:(?!data-clipboard-text)[\s\S])*?#linkIcon_f_/i);
            const toM = rowHtml.match(/data-clipboard-text='(0x[0-9a-fA-F]{40})'(?:(?!data-clipboard-text)[\s\S])*?#linkIcon_t_/i);
            const from = fromM?.[1] ?? null;
            const to = toM?.[1] ?? null;
            let timestamp;
            const unixM = rowHtml.match(/showLocalDate[^>]*>\s*(\d{10})\s*</)
                ?? rowHtml.match(/[?&]time=(\d{10})\b/);
            if (unixM) {
                timestamp = Number(unixM[1]) * 1000;
            }
            else {
                const dtM = rowHtml.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
                if (dtM) {
                    const ms = Date.parse(`${dtM[1]}T${dtM[2].padStart(2, '0')}:${dtM[3]}:${dtM[4]}Z`);
                    if (!isNaN(ms))
                        timestamp = ms;
                }
                if (timestamp == null) {
                    const uxM = rowHtml.match(/\b(1[5-9]\d{8})\b/);
                    if (uxM)
                        timestamp = Number(uxM[1]) * 1000;
                }
            }
            const titleM = rowHtml.match(/td_showAmount[^>]*data-bs-title="([^"]*)"/i);
            let amount = 0;
            let usdValue;
            if (titleM) {
                const [left, right] = titleM[1].split('|');
                amount = this.parseScanAmount(left ?? '');
                if (right)
                    usdValue = this.parseScanUsd(right);
            }
            if (type === 'token') {
                const ti = rowHtml.lastIndexOf('/token/');
                const cell = ti >= 0 ? rowHtml.slice(ti) : rowHtml;
                const symM = cell.match(/title="[^"]*\(([^)]{1,32})\)"/i)
                    ?? cell.match(/text-muted">\(([^)]{1,24})\)/)
                    ?? cell.match(/hash-tag text-truncate">([^<]{1,40})</);
                const asset = (symM?.[1] ?? 'TOKEN')
                    .replace(/…$/, '').replace(/\.\.\.$/, '')
                    .replace(/^(?:BEP-20|ERC-20|TRC-20|[A-Z]+-\d+):\s*/i, '').trim() || 'TOKEN';
                out.push({ network, hash, from, to, amount, asset, usdValue, timestamp });
            }
            else {
                out.push({ network, hash, from, to, amount, asset: this.nativeAsset(network), usdValue, timestamp });
            }
        }
        return out;
    }
    classifyScanPage(html, parsed) {
        if (parsed > 0)
            return 'ok';
        if (/href="\/tx\/0x[0-9a-fA-F]{64}"/i.test(html))
            return 'drift';
        if (/no matching entries|no transactions found|there are no|no records found/i.test(html))
            return 'empty';
        if (/<tbody/i.test(html) && html.length > 2000)
            return 'empty';
        return 'down';
    }
    mergeStatus(ss) {
        if (ss.includes('down'))
            return 'down';
        if (ss.includes('drift'))
            return 'drift';
        if (ss.includes('ok'))
            return 'ok';
        return 'empty';
    }
    async fetchScanPaged(scanBase, path, network, type, keep, limit) {
        const kept = [];
        let parsed = 0;
        let page = 0;
        let failed = false;
        let status = 'empty';
        const ps = EvmProvider_1.SCAN_PAGE_SIZE;
        for (page = 1; page <= EvmProvider_1.SCAN_MAX_PAGES; page++) {
            const fullUrl = `${scanBase}/${path}&ps=${ps}&p=${page}`;
            const html = await this.fetchScanPage(fullUrl, scanBase);
            if (html === null) {
                if (page === 1) {
                    failed = true;
                    status = 'down';
                }
                break;
            }
            const rows = this.parseScanRows(html, network, type);
            parsed += rows.length;
            if (page === 1) {
                status = this.classifyScanPage(html, rows.length);
                if (status === 'drift') {
                    const firstTxRow = html.match(/<tr[^>]*>[\s\S]*?href="\/tx\/0x[0-9a-fA-F]{64}"[\s\S]*?<\/tr>/i);
                    this.logger.error(`[Scan] ${network} ${type} PARSE DRIFT — markup has tx rows but parsed 0. First row:\n${firstTxRow?.[0]?.replace(/<[^>]+>/g, '⟨tag⟩').slice(0, 600) ?? html.slice(0, 400)}`);
                }
            }
            kept.push(...rows.filter(keep));
            if (rows.length < ps) {
                break;
            }
            if (kept.length >= limit) {
                break;
            }
        }
        return { kept: kept.slice(0, limit), parsed, pages: page, failed, status };
    }
    async fetchWalletTransfersScan(network, address, opts) {
        const scanBase = SCAN_HOSTS[network];
        const source = scanBase.replace(/^https?:\/\//, '');
        const out = [];
        let diag = null;
        const statuses = [];
        if (opts.token) {
            const r = await this.fetchScanPaged(scanBase, `tokentxns?a=${address}`, network, 'token', (t) => (t.usdValue ?? 0) >= 1, opts.limit);
            this.logger.log(`[Scan] ${network} token: ${r.parsed} parsed over ${r.pages} page(s), ${r.kept.length} kept (USD≥$1) [${r.status}]`);
            if (r.failed)
                diag = `${network}: не удалось загрузить токен-переводы с ${scanBase}`;
            statuses.push(r.status);
            out.push(...r.kept);
        }
        if (opts.native) {
            const r = await this.fetchScanPaged(scanBase, `txs?a=${address}`, network, 'native', (t) => (t.amount ?? 0) > 0, opts.limit);
            this.logger.log(`[Scan] ${network} native: ${r.parsed} parsed over ${r.pages} page(s), ${r.kept.length} with value [${r.status}]`);
            if (r.failed)
                diag = `${network}: не удалось загрузить транзакции с ${scanBase}`;
            statuses.push(r.status);
            out.push(...r.kept);
        }
        const status = this.mergeStatus(statuses);
        if (status === 'drift')
            diag = `${network}: разметка ${source} изменилась — скрейпер устарел (0 распознано из непустой страницы)`;
        else if (status === 'down' && !diag)
            diag = `${network}: источник ${source} недоступен`;
        return { transfers: out, diag: out.length ? null : diag, status, source };
    }
    async fetchWalletTransfers(network, address, opts) {
        const chainid = EVM_CHAINS[network];
        if (!chainid)
            return { transfers: [], diag: `unsupported EVM network: ${network}`, status: 'down', source: 'evm' };
        if (network in SCAN_HOSTS) {
            return this.fetchWalletTransfersScan(network, address, opts);
        }
        const source = `etherscan:${network}`;
        const KEY = this.key();
        if (!KEY)
            return { transfers: [], diag: 'ETHERSCAN_API_KEY не задан на сервере (server/.env)', status: 'down', source };
        const out = [];
        let diag = null;
        const call = async (action) => {
            const url = `${EVM_BASE}?chainid=${chainid}&module=account&action=${action}&address=${address}&page=1&offset=${opts.limit}&sort=desc&apikey=${KEY}`;
            const j = await this.fetchJsonRetry(url);
            if (!Array.isArray(j['result'])) {
                diag = [j['message'], typeof j['result'] === 'string' ? j['result'] : ''].filter(Boolean).join(': ') || 'unexpected response';
                this.logger.warn(`[explorer] ${network}/${action} → ${diag}`);
                return [];
            }
            return j['result'];
        };
        if (opts.native) {
            for (const t of await call('txlist')) {
                out.push({ network, hash: t['hash'], from: t['from'], to: t['to'], amount: Number(BigInt(t['value'] || '0')) / 1e18, asset: this.nativeAsset(network), timestamp: Number(t['timeStamp']) * 1000 });
            }
        }
        if (opts.token) {
            for (const t of await call('tokentx')) {
                const dec = Number(t['tokenDecimal'] || 18);
                out.push({ network, hash: t['hash'], from: t['from'], to: t['to'], amount: Number(BigInt(t['value'] || '0')) / 10 ** dec, asset: t['tokenSymbol'] || '', timestamp: Number(t['timeStamp']) * 1000 });
            }
        }
        const status = diag ? 'down' : out.length ? 'ok' : 'empty';
        return { transfers: out, diag: out.length ? null : diag, status, source };
    }
    async fetchBalance(network, address) {
        const asset = this.nativeAsset(network);
        const rpc = PUBLIC_RPC[network];
        if (!rpc)
            return { amount: null, asset, diag: `unsupported EVM network: ${network}` };
        try {
            const hex = await this.rpcPost(rpc, 'eth_getBalance', [address, 'latest']);
            if (hex == null)
                return { amount: null, asset, diag: `${network}: RPC вернул пустой ответ` };
            return { amount: Number(BigInt(hex)) / 1e18, asset, diag: null };
        }
        catch (e) {
            return { amount: null, asset, diag: String(e?.message || e) };
        }
    }
    async fetchTokenBalances(network, address) {
        const rpc = PUBLIC_RPC[network];
        if (!rpc || !(network in EVM_CHAINS))
            return [];
        const contracts = await this.discoverTokenContracts(network, address).catch(() => new Map());
        const entries = [...contracts.entries()].slice(0, 25);
        const padded = address.toLowerCase().replace('0x', '').padStart(64, '0');
        const out = [];
        await Promise.all(entries.map(async ([contract, info]) => {
            try {
                const balHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: EvmProvider_1.ERC20_BALANCEOF + padded }, 'latest']).catch(() => null);
                if (!balHex || balHex === '0x' || /^0x0*$/.test(balHex))
                    return;
                let decimals = info.decimals;
                if (decimals == null || isNaN(decimals)) {
                    const decHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: '0x313ce567' }, 'latest']).catch(() => null);
                    const d = decHex ? parseInt(decHex.replace('0x', ''), 16) : NaN;
                    decimals = isNaN(d) ? 18 : d;
                }
                let symbol = info.symbol;
                if (!symbol) {
                    const symHex = await this.rpcPost(rpc, 'eth_call', [{ to: contract, data: '0x95d89b41' }, 'latest']).catch(() => null);
                    symbol = this.decodeAbiString(symHex) || 'TOKEN';
                }
                const amount = Number(BigInt(balHex)) / 10 ** decimals;
                if (amount > 0)
                    out.push({ asset: symbol, amount });
            }
            catch { }
        }));
        return out;
    }
    async discoverTokenContracts(network, address) {
        const m = new Map();
        if (network in SCAN_HOSTS) {
            const html = await this.fetchScanPage(`${SCAN_HOSTS[network]}/tokentxns?a=${address}&ps=100&p=1`, SCAN_HOSTS[network]);
            if (html)
                for (const mm of html.matchAll(/\/token\/(0x[0-9a-fA-F]{40})/g)) {
                    if (m.size < 40)
                        m.set(mm[1].toLowerCase(), {});
                }
            return m;
        }
        const chainid = EVM_CHAINS[network];
        const KEY = this.key();
        if (!KEY || !chainid)
            return m;
        const j = await this.fetchJsonRetry(`${EVM_BASE}?chainid=${chainid}&module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${KEY}`);
        if (Array.isArray(j['result'])) {
            for (const t of j['result']) {
                const c = (t['contractAddress'] || '').toLowerCase();
                if (c && !m.has(c))
                    m.set(c, { symbol: t['tokenSymbol'], decimals: Number(t['tokenDecimal']) });
            }
        }
        return m;
    }
    isSupported(network) {
        return network in EVM_CHAINS;
    }
};
exports.EvmProvider = EvmProvider;
EvmProvider.SCAN_MAX_PAGES = 20;
EvmProvider.SCAN_PAGE_SIZE = 100;
EvmProvider.ERC20_BALANCEOF = '0x70a08231';
exports.EvmProvider = EvmProvider = EvmProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EvmProvider);
//# sourceMappingURL=evm.provider.js.map