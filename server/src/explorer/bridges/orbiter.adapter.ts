import { Injectable } from '@nestjs/common';
import { OrbiterProvider } from '../providers/orbiter.provider';
import type { BridgeAdapter, BridgeResolveCtx } from './bridge-adapter.interface';

@Injectable()
export class OrbiterAdapter implements BridgeAdapter {
  readonly id = 'orbiter';
  readonly name = 'Orbiter Finance';
  constructor(private readonly provider: OrbiterProvider) {}

  resolve(hash: string, ctx: BridgeResolveCtx) {
    return this.provider.resolve(hash, ctx.chainId, ctx.tsMs, ctx.fast ?? false);
  }
}
