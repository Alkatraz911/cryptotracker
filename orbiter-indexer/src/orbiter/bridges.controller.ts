import { Controller, Get, Param, Query } from '@nestjs/common';
import { BridgesService } from './bridges.service';
import { QueryBridgesDto } from './dto/query-bridges.dto';
import { ORBITER_CHAINS } from './orbiter.client';

const ms = (s?: string) => { if (!s) return undefined; const t = Date.parse(s); return isNaN(t) ? undefined : t; };

@Controller('bridges')
export class BridgesController {
  constructor(private readonly bridges: BridgesService) {}

  @Get('stats')
  stats() { return this.bridges.stats(); }

  @Get('chains')
  chains() {
    return Object.entries(ORBITER_CHAINS).map(([id, c]) => ({ id, name: c.name, net: c.net }));
  }

  @Get('tx/:hash')
  async byHash(@Param('hash') hash: string) {
    return { bridge: await this.bridges.byHash(hash) };
  }

  @Get('address/:address')
  async byAddress(@Param('address') address: string, @Query('limit') limit?: string) {
    return { bridges: await this.bridges.byAddress(address, limit ? Number(limit) : 100) };
  }

  @Get()
  async search(@Query() q: QueryBridgesDto) {
    return {
      bridges: await this.bridges.search({
        sourceChain: q.source, targetChain: q.target, minUsd: q.minUsd,
        sinceMs: ms(q.from), untilMs: ms(q.to), limit: q.limit,
      }),
    };
  }
}
