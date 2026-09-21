import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExplorerService } from './explorer.service';
import { ExplorerController } from './explorer.controller';
import { BridgeRegistryService } from './bridge-registry.service';
import { BridgeAddress } from './entities/bridge-address.entity';
import { AddressLabel } from './entities/address-label.entity';
import { LabelRegistryService } from './label-registry.service';
import { EvmProvider } from './providers/evm.provider';
import { TronProvider } from './providers/tron.provider';
import { SolanaProvider } from './providers/solana.provider';
import { OrbiterProvider } from './providers/orbiter.provider';
import { DebridgeProvider } from './providers/debridge.provider';
import { PriceProvider } from './providers/price.provider';
import { BridgeHubService } from './bridges/bridge-hub.service';
import { OrbiterAdapter } from './bridges/orbiter.adapter';
import { DebridgeAdapter } from './bridges/debridge.adapter';
import { LifiAdapter } from './bridges/lifi.adapter';
import { AcrossAdapter } from './bridges/across.adapter';
import { ProviderHealthService } from './provider-health.service';
import { ProviderHealthEntry } from './entities/provider-health.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BridgeAddress, AddressLabel, ProviderHealthEntry])],
  providers: [
    ExplorerService, BridgeRegistryService, LabelRegistryService, ProviderHealthService,
    EvmProvider, TronProvider, SolanaProvider, OrbiterProvider, DebridgeProvider, PriceProvider,
    BridgeHubService, OrbiterAdapter, DebridgeAdapter, LifiAdapter, AcrossAdapter,
  ],
  controllers: [ExplorerController],
  exports: [ExplorerService],
})
export class ExplorerModule {}
