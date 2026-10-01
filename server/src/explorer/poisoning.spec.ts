import { markPoisoning } from './poisoning';
import type { TransferItem } from './providers/evm.provider';

describe('address poisoning', () => {
  const wallet = '0x' + '1'.repeat(40);
  const real = '0xaaaa' + '2'.repeat(32) + 'bbbb';
  const fake = '0xaaaa' + '3'.repeat(32) + 'bbbb';
  it('marks a tiny lookalike transfer', () => {
    const transfers: TransferItem[] = [
      { network: 'ETH', hash: '1', from: wallet, to: real, usdValue: 100, amount: 100 },
      { network: 'ETH', hash: '2', from: fake, to: wallet, usdValue: 0, amount: 0 },
    ];
    markPoisoning(transfers, wallet);
    expect(transfers[1].poisoning).toEqual({ lookalikeOf: real });
  });
  it('does not mark a high-value similar counterparty', () => {
    const transfers: TransferItem[] = [
      { network: 'ETH', hash: '1', from: wallet, to: real, usdValue: 100 },
      { network: 'ETH', hash: '2', from: fake, to: wallet, usdValue: 20 },
    ];
    markPoisoning(transfers, wallet);
    expect(transfers[1].poisoning).toBeUndefined();
  });
  it('compares TRON addresses after the leading T', () => {
    const tronWallet = 'T' + '1'.repeat(33);
    const tronReal = 'Taaaa' + '2'.repeat(25) + 'bbbb';
    const tronFake = 'Taaaa' + '3'.repeat(25) + 'bbbb';
    const transfers: TransferItem[] = [
      { network: 'TRON', hash: '1', from: tronWallet, to: tronReal, usdValue: 50 },
      { network: 'TRON', hash: '2', from: tronFake, to: tronWallet, usdValue: 0 },
    ];
    markPoisoning(transfers, tronWallet);
    expect(transfers[1].poisoning).toEqual({ lookalikeOf: tronReal });
  });
  it('does not compare counterparties from different networks', () => {
    const transfers: TransferItem[] = [
      { network: 'ETH', hash: '1', from: wallet, to: real, usdValue: 50 },
      { network: 'BSC', hash: '2', from: fake, to: wallet, usdValue: 0 },
    ];
    markPoisoning(transfers, wallet);
    expect(transfers[1].poisoning).toBeUndefined();
  });
});
