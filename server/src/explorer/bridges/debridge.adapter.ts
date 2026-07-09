import { Injectable } from '@nestjs/common';
import { DebridgeProvider } from '../providers/debridge.provider';
import type { BridgeAdapter } from './bridge-adapter.interface';

@Injectable()
export class DebridgeAdapter implements BridgeAdapter {
  readonly id = 'debridge';
  readonly name = 'deBridge';
  constructor(private readonly provider: DebridgeProvider) {}

  async resolve(hash: string) {
    const hop = await this.provider.resolve(hash);
    return { hop, outOfRange: false };
  }
}
