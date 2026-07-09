import { Controller, Get, Param, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { DLN_CHAINS } from './dln.client';

const ms = (s?: string) => { if (!s) return undefined; const t = Date.parse(s); return isNaN(t) ? undefined : t; };

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stats')
  stats() { return this.orders.stats(); }

  @Get('chains')
  chains() { return Object.entries(DLN_CHAINS).map(([id, c]) => ({ id, name: c.name, net: c.net })); }

  @Get('tx/:hash')
  async byHash(@Param('hash') hash: string) {
    return { order: await this.orders.byHash(hash) };
  }

  @Get('address/:address')
  async byAddress(@Param('address') address: string, @Query('limit') limit?: string) {
    return { orders: await this.orders.byAddress(address, limit ? Number(limit) : 100) };
  }

  @Get()
  async search(@Query() q: QueryOrdersDto) {
    return {
      orders: await this.orders.search({
        giveChain: q.give, takeChain: q.take, sinceMs: ms(q.from), untilMs: ms(q.to), limit: q.limit,
      }),
    };
  }
}
