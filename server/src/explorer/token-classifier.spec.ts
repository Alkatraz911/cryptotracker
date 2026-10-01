import { classifyToken, normalizedSymbol } from './token-classifier';

const trusted = [{ network: 'BSC', contract: '0xreal', symbol: 'USDT' }];

describe('token classifier', () => {
  it('normalizes Cyrillic and symbol lookalikes', () => {
    expect(normalizedSymbol('USDТ')).toBe('USDT');
    expect(normalizedSymbol('USD®')).toBe('USDT');
    expect(classifyToken({ network: 'BSC', contract: '0xfake', symbol: 'USDТ' }, trusted).status).toBe('scam');
    expect(classifyToken({ network: 'BSC', contract: '0xfake', symbol: 'USD®' }, trusted).status).toBe('scam');
  });

  it('marks URL and airdrop bait as scam', () => {
    expect(classifyToken({ network: 'SOLANA', contract: 'mint', name: 'Claim reward at gift.xyz' }, trusted).status).toBe('scam');
  });

  it('trusts a CoinGecko contract and leaves unrelated tokens visible', () => {
    expect(classifyToken({ network: 'BSC', contract: '0xreal', symbol: 'USDT', coingeckoId: 'tether' }, trusted).status).toBe('trusted');
    expect(classifyToken({ network: 'ETH', contract: '0xfake', symbol: 'USDT' }, trusted).status).toBe('unknown');
    expect(classifyToken({ network: 'BSC', contract: '0xother', symbol: 'ABC' }, trusted).status).toBe('unknown');
  });
});
