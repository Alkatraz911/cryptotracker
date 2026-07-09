import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrbiterModule } from './orbiter/orbiter.module';
import { OrbiterBridge } from './orbiter/entities/orbiter-bridge.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        entities: [OrbiterBridge],
        synchronize: cfg.get<string>('DB_SYNC', 'true') !== 'false',
      }),
    }),
    OrbiterModule,
  ],
})
export class AppModule {}
