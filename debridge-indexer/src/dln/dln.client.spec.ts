import { DlnClient, DLN_CHAINS, NET_TO_DLN, sv } from './dln.client';

describe('DLN chains + helpers', () => {
  it('maps core chains to networks', () => {
    expect(DLN_CHAINS['56'].net).toBe('BSC');
    expect(DLN_CHAINS['8453'].net).toBe('BASE');
    expect(DLN_CHAINS['7565164'].net).toBe('SOLANA');
  });

  it('maps networks back to DLN chain ids', () => {
    expect(NET_TO_DLN.ARBITRUM).toBe('42161');
    expect(NET_TO_DLN.SOLANA).toBe('7565164');
  });

  it('sv() unwraps scalar shapes', () => {
    expect(sv({ stringValue: '0xabc' })).toBe('0xabc');
    expect(sv('plain')).toBe('plain');
    expect(sv(null)).toBeNull();
  });

  it('amount() applies decimals', () => {
    expect(DlnClient.amount({ amount: { stringValue: '2500000' }, decimals: 6 })).toBeCloseTo(2.5);
    expect(DlnClient.amount({ amount: null })).toBeNull();
  });
});
