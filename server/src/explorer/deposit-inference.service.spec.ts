import { DepositInferenceService, entityOf, isDepositLabel, InferenceDeps, KnownLabel } from './deposit-inference.service';
import type { TransferItem } from './providers/evm.provider';

const NATIVE = new Set(['TRX']);
// Real TRON addresses from the check against OKX tags.
const BINANCE_HOT = 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf';
const KRAKEN_HOT = 'TG2CMGxnTPgQ6V58kiKd7wbyN8ewtAmY76';
const KRAKEN_COLLECTOR = 'TTd9qHyjqiUkfTxe3gotbuTMpjU8LEbpkN';
const FF_HOT = 'TDoXUNZ6PajKuiUkcYg3EDSV9bnqGqsbcf';
const DEP = 'TLXZxKcduSDxXQynpoCatnY5S4ET9SNACP';
const PAYER = 'TSEeVWBeDMpB96vERvkGkqsAanL4rnU8fx';

let n = 0;
const tx = (from: string, to: string, amount: number, asset = 'USDT', usd: number | undefined = asset === 'USDT' ? amount : undefined): TransferItem =>
  ({ network: 'TRON', hash: `h${n++}`, from, to, amount, asset, usdValue: usd });

function deps(labels: Record<string, KnownLabel>, histories: Record<string, TransferItem[]> = {}) {
  const remembered: Array<[string, string]> = [];
  const d: InferenceDeps = {
    labelOf: jest.fn(async (a: string) => labels[a] ?? null),
    transfersOf: jest.fn(async (a: string) => histories[a] ?? []),
    remember: (a, l) => { remembered.push([a, l]); },
  };
  return { d, remembered };
}

describe('entityOf', () => {
  it.each([
    ['Exchange: Binance. User', 'Binance'],
    ['Binance. User', 'Binance'],
    ['Exchange: FixedFloat. DepositAndWithdraw_2', 'FixedFloat'],
    ['FixedFloat. DepositAndWithdraw_2', 'FixedFloat'],
    ['Bybit: Hot Wallet', 'Bybit'],
    ['Binance-Hot 3', 'Binance'],
    ['FixedFloat Exchange Hot Wallet', 'FixedFloat'],
    ['Binance 14', 'Binance'],
    ['Kraken: collector (inferred)', 'Kraken'],
    ['OKX', 'OKX'],
  ])('%s → %s', (label, entity) => expect(entityOf(label)).toBe(entity));
});

describe('isDepositLabel', () => {
  it('treats customer deposits (OKX "User", our inferred deposits) as non-anchors, exchange wallets as anchors', () => {
    expect(isDepositLabel('Exchange: Binance. User', 'okx')).toBe(true);
    expect(isDepositLabel('Binance: deposit (inferred)', 'inferred')).toBe(true);
    expect(isDepositLabel('Kraken: collector (inferred)', 'inferred')).toBe(false);
    expect(isDepositLabel('FixedFloat. DepositAndWithdraw_2', 'okx')).toBe(false);
    expect(isDepositLabel('Binance-Hot 3', 'tronscan')).toBe(false);
  });
});

describe('DepositInferenceService', () => {
  const svc = new DepositInferenceService();

  it('a one-off deposit: paid in, gas from the hot wallet, everything swept to it (FixedFloat)', async () => {
    const { d } = deps({ [FF_HOT]: { label: 'FixedFloat. DepositAndWithdraw_2', source: 'okx' } });
    const hist = [tx(PAYER, DEP, 4685), tx(FF_HOT, DEP, 20, 'TRX'), tx(DEP, FF_HOT, 4685), tx(DEP, FF_HOT, 19.9, 'TRX')];
    expect(await svc.infer(DEP, hist, NATIVE, d)).toMatchObject({ label: 'FixedFloat: deposit (inferred)', entity: 'FixedFloat', share: 1 });
  });

  it('a permanent deposit with many payers still sweeps everything to the exchange (Binance)', async () => {
    const { d } = deps({ [BINANCE_HOT]: { label: 'Binance-Hot 3', source: 'tronscan' } });
    const hist: TransferItem[] = [];
    for (let i = 0; i < 40; i++) { hist.push(tx(`TPayer${i}`, DEP, 100 + i)); hist.push(tx(DEP, BINANCE_HOT, 100 + i)); }
    expect((await svc.infer(DEP, hist, NATIVE, d))?.label).toBe('Binance: deposit (inferred)');
  });

  it('shares add up across wallets of one exchange, via a collector found one hop deep (Kraken)', async () => {
    const collectorHist: TransferItem[] = [];
    for (let i = 0; i < 12; i++) collectorHist.push(tx(`TDep${i}`, KRAKEN_COLLECTOR, 1000));
    collectorHist.push(tx(KRAKEN_COLLECTOR, KRAKEN_HOT, 12000));
    const { d, remembered } = deps({ [KRAKEN_HOT]: { label: 'Exchange: Kraken. Hot', source: 'okx' } }, { [KRAKEN_COLLECTOR]: collectorHist });
    const hist = [tx(PAYER, DEP, 1000), tx(DEP, KRAKEN_COLLECTOR, 562), tx(DEP, KRAKEN_HOT, 438)];
    const r = await svc.infer(DEP, hist, NATIVE, d);
    expect(r).toMatchObject({ label: 'Kraken: deposit (inferred)' });
    expect(r?.share).toBeCloseTo(1);
    expect(remembered).toEqual([[KRAKEN_COLLECTOR, 'Kraken: collector (inferred)']]);
  });

  it('a hot-wallet payout recipient that spends elsewhere is not a deposit', async () => {
    const { d } = deps({ [BINANCE_HOT]: { label: 'Binance-Hot 3', source: 'tronscan' } });
    const hist = [tx(BINANCE_HOT, DEP, 5000), tx(DEP, 'TShop1', 3000), tx(DEP, 'TShop2', 1500), tx(DEP, BINANCE_HOT, 400)];
    expect(await svc.infer(DEP, hist, NATIVE, d)).toBeNull();
  });

  it('never chains through a deposit: a wallet that always tops up its Binance deposit stays unlabelled', async () => {
    const MY_DEPOSIT = 'TGLXVZBCJjnuZcKEJ2DC1JC8gjvqUAMCRJ';
    const { d } = deps({ [MY_DEPOSIT]: { label: 'Binance: deposit (inferred)', source: 'inferred' } });
    const hist = [tx(PAYER, DEP, 900), tx(DEP, MY_DEPOSIT, 900)];
    expect(await svc.infer(DEP, hist, NATIVE, d)).toBeNull();
    expect(d.transfersOf).toHaveBeenCalledTimes(1); // one collector probe, not a chain
  });

  it('95% is the bar: 90% to the exchange is not enough', async () => {
    const { d } = deps({ [BINANCE_HOT]: { label: 'Binance-Hot 3', source: 'tronscan' } });
    const hist = [tx(DEP, BINANCE_HOT, 900), tx(DEP, 'TSomeoneElse', 100)];
    expect(await svc.infer(DEP, hist, NATIVE, d)).toBeNull();
  });

  it('ignores native-coin gas returns and addresses that never sent tokens', async () => {
    const { d } = deps({ [FF_HOT]: { label: 'FixedFloat. DepositAndWithdraw_2', source: 'okx' } });
    expect(await svc.infer(DEP, [tx(PAYER, DEP, 50), tx(DEP, FF_HOT, 19, 'TRX')], NATIVE, d)).toBeNull();
    expect(d.labelOf).not.toHaveBeenCalled();
  });

  it('an unlabelled destination with few senders is not taken for a collector', async () => {
    const { d, remembered } = deps({ [KRAKEN_HOT]: { label: 'Kraken', source: 'okx' } },
      { TFriend: [tx(DEP, 'TFriend', 1000), tx('TFriend', KRAKEN_HOT, 1000)] });
    expect(await svc.infer(DEP, [tx(DEP, 'TFriend', 1000)], NATIVE, d)).toBeNull();
    expect(remembered).toEqual([]);
  });
});
