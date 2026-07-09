"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var LifiAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifiAdapter = void 0;
const common_1 = require("@nestjs/common");
const orbiter_provider_1 = require("../providers/orbiter.provider");
const LIFI_STATUS = 'https://li.quest/v1/status';
let LifiAdapter = LifiAdapter_1 = class LifiAdapter {
    constructor() {
        this.id = 'lifi';
        this.name = 'LI.FI';
        this.logger = new common_1.Logger(LifiAdapter_1.name);
    }
    async resolve(hash) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10000);
        try {
            const r = await fetch(`${LIFI_STATUS}?txHash=${encodeURIComponent(hash)}`, { signal: ac.signal });
            if (!r.ok)
                return { hop: null, outOfRange: false };
            const d = await r.json();
            const send = d.sending, recv = d.receiving;
            if (d.status !== 'DONE' || !send?.txHash || !recv?.txHash)
                return { hop: null, outOfRange: false };
            if (send.txHash.toLowerCase() !== hash.toLowerCase())
                return { hop: null, outOfRange: false };
            if (send.chainId == null || recv.chainId == null || send.chainId === recv.chainId)
                return { hop: null, outOfRange: false };
            const srcChain = String(send.chainId), dstChain = String(recv.chainId);
            const sdef = orbiter_provider_1.ORBITER_CHAINS[srcChain], tdef = orbiter_provider_1.ORBITER_CHAINS[dstChain];
            const dec = recv.token?.decimals ?? 18;
            const amount = recv.amount != null ? Number(recv.amount) / 10 ** dec : 0;
            const hop = {
                sourceId: send.txHash, targetId: recv.txHash,
                sourceChain: srcChain, targetChain: dstChain,
                sourceChainName: sdef?.name ?? `chain ${srcChain}`,
                targetChainName: tdef?.name ?? `chain ${dstChain}`,
                sourceNet: sdef?.net ?? 'UNKNOWN', targetNet: tdef?.net ?? 'UNKNOWN',
                sourceTxUrl: send.txLink ?? (sdef ? sdef.tx(send.txHash) : ''),
                targetTxUrl: recv.txLink ?? (tdef ? tdef.tx(recv.txHash) : ''),
                amount, symbol: recv.token?.symbol ?? send.token?.symbol ?? '',
                usd: Number(recv.amountUSD) || Number(send.amountUSD) || 0,
                sourceTime: send.timestamp ? send.timestamp * 1000 : Date.now(),
                sourceAddress: d.fromAddress, targetWallet: d.toAddress,
            };
            this.logger.log(`[LI.FI] match ${srcChain}→${dstChain}`);
            return { hop, outOfRange: false };
        }
        catch (e) {
            this.logger.warn(`[LI.FI] ${e?.message}`);
            return { hop: null, outOfRange: false };
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.LifiAdapter = LifiAdapter;
exports.LifiAdapter = LifiAdapter = LifiAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], LifiAdapter);
//# sourceMappingURL=lifi.adapter.js.map