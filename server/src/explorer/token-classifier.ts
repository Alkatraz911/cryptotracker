import type { TokenStatus } from './entities/token-contract.entity';

const HOMOGLYPHS: Record<string, string> = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O',
  'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S', '®': 'T',
};
export const normalizedSymbol = (value: string) => value.normalize('NFKC').toUpperCase()
  .replace(/[АВСЕНКМОРТХУІЈЅ®]/g, (c) => HOMOGLYPHS[c] ?? c)
  .replace(/[\s.]/g, '');

const BAIT = /https?:|www\.|t\.me|\.(?:com|io|xyz|app|site|top|gift)\b|\b(?:claim|reward|airdrop|visit|voucher|bonus|gift)\b/i;

export function classifyToken(input: {
  network: string; contract: string; symbol?: string | null; name?: string | null;
  coingeckoId?: string | null;
}, trusted: Array<{ network: string; contract: string; symbol: string | null }>): { status: TokenStatus; reason: string | null; source: 'coingecko' | 'heuristic' | 'seen' } {
  if (input.coingeckoId) return { status: 'trusted', reason: null, source: 'coingecko' };
  const symbol = normalizedSymbol(input.symbol ?? '');
  if (symbol && trusted.some((t) => t.network === input.network && t.contract !== input.contract && normalizedSymbol(t.symbol ?? '') === symbol))
    return { status: 'scam', reason: 'Подмена тикера доверенного токена', source: 'heuristic' };
  if (BAIT.test(`${input.name ?? ''} ${input.symbol ?? ''}`))
    return { status: 'scam', reason: 'Ссылка или приманка в названии токена', source: 'heuristic' };
  return { status: 'unknown', reason: null, source: 'seen' };
}
