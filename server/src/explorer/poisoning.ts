import type { TransferItem } from './providers/evm.provider';

const comparable = (address: string, network: string) => {
  const a = network === 'TRON' ? address.slice(1) : address.replace(/^0x/i, '');
  return a.toLowerCase();
};

export function markPoisoning(transfers: TransferItem[], wallet: string): void {
  const realByNetwork = new Map<string, Set<string>>();
  const me = wallet.toLowerCase();
  for (const t of transfers) {
    if ((t.usdValue ?? 0) < 10) continue;
    const cp = t.from?.toLowerCase() === me ? t.to : t.from;
    if (cp) {
      const real = realByNetwork.get(t.network) ?? new Set<string>();
      real.add(cp);
      realByNetwork.set(t.network, real);
    }
  }
  for (const t of transfers) {
    if ((t.usdValue ?? 0) >= 1) continue;
    const cp = t.from?.toLowerCase() === me ? t.to : t.from;
    const real = realByNetwork.get(t.network);
    if (!real) continue;
    if (!cp || real.has(cp)) continue;
    const c = comparable(cp, t.network);
    if (c.length < 8) continue;
    for (const r of real) {
      const target = comparable(r, t.network);
      if (target.length === c.length && target.slice(0, 4) === c.slice(0, 4) && target.slice(-4) === c.slice(-4)) {
        t.poisoning = { lookalikeOf: r };
        break;
      }
    }
  }
}
