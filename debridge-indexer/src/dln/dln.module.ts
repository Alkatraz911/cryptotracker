import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebridgeOrder } from './entities/debridge-order.entity';
import { DlnClient } from './dln.client';
import { OrdersService } from './orders.service';
import { IngestService } from './ingest.service';
import { OrdersController } from './orders.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DebridgeOrder])],
  controllers: [OrdersController, AdminController],
  providers: [DlnClient, OrdersService, IngestService],
  exports: [DlnClient, OrdersService, IngestService],
})
export class DlnModule {}
