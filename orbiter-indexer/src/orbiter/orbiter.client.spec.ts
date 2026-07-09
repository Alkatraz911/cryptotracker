import { ORBITER_CHAINS, ORBITER_CHAIN_IDS } from './orbiter.client';

describe('ORBITER_CHAINS', () => {
  it('maps the core chains to our networks', () => {
    expect(ORBITER_CHAINS['42161'].net).toBe('ARBITRUM');
    expect(ORBITER_CHAINS['8453'].net).toBe('BASE');
    expect(ORBITER_CHAINS['1'].net).toBe('ETH');
  });

  it('builds explorer tx urls', () => {
    expect(ORBITER_CHAINS['8453'].tx('0xabc')).toBe('https://basescan.org/tx/0xabc');
  });

  it('exposes all chain ids', () => {
    expect(ORBITER_CHAIN_IDS).toContain('10');     // Optimism
    expect(ORBITER_CHAIN_IDS).toContain('59144');  // Linea
    expect(ORBITER_CHAIN_IDS.length).toBeGreaterThanOrEqual(10);
  });
});
