import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChainDataService } from './chaindata.service';

@Controller('chaindata')
@UseGuards(JwtAuthGuard)
export class ChainDataController {
  constructor(private readonly chaindata: ChainDataService) {}

  // Wallet transfers from the shared store (fetched from the explorer once, then
  // reused). `force=true` re-fetches and refreshes the store.
  @Get('wallet')
  getWallet(
    @Query('network') network: string,
    @Query('address') address: string,
    @Query('native') native: string,
    @Query('token') token: string,
    @Query('limit') limit: string,
    @Query('force') force: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('asset') asset: string,
  ) {
    if (!network || !address) return { transfers: [], diag: null };
    return this.chaindata.walletTransfers(network, address, {
      native: native !== 'false',
      token: token !== 'false',
      // No small default cap — load/return the wallet's full stored history (the
      // explorer fetch and the DB query are both bounded by MAX_TRANSFERS).
      limit: limit ? Number(limit) : 2000,
      force: force === 'true',
      fromMs: from ? Number(from) : undefined,
      toMs: to ? Number(to) : undefined,
      asset: asset || undefined,
    });
  }
}
