import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrbiterBridge } from './entities/orbiter-bridge.entity';
import { OrbiterClient } from './orbiter.client';
import { BridgesService } from './bridges.service';
import { IngestService } from './ingest.service';
import { BridgesController } from './bridges.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrbiterBridge])],
  controllers: [BridgesController, AdminController],
  providers: [OrbiterClient, BridgesService, IngestService],
  exports: [BridgesService, IngestService, OrbiterClient],
})
export class OrbiterModule {}
