import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExplorerModule } from '../explorer/explorer.module';
import { ChainDataService } from './chaindata.service';
import { ChainDataController } from './chaindata.controller';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, Transaction]), ExplorerModule],
  providers: [ChainDataService],
  controllers: [ChainDataController],
})
export class ChainDataModule {}
