import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DlnModule } from './dln/dln.module';
import { DebridgeOrder } from './dln/entities/debridge-order.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        entities: [DebridgeOrder],
        synchronize: cfg.get<string>('DB_SYNC', 'true') !== 'false',
      }),
    }),
    DlnModule,
  ],
})
export class AppModule {}
