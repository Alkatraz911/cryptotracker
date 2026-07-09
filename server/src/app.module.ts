import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { ExplorerModule } from './explorer/explorer.module';
import { ChainDataModule } from './chaindata/chaindata.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AiModule } from './ai/ai.module';
import { User } from './users/entities/user.entity';
import { Project } from './projects/entities/project.entity';
import { Wallet } from './chaindata/entities/wallet.entity';
import { Transaction } from './chaindata/entities/transaction.entity';
import { BridgeAddress } from './explorer/entities/bridge-address.entity';
import { UsageEvent } from './analytics/entities/usage-event.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        entities: [User, Project, Wallet, Transaction, BridgeAddress, UsageEvent],
        synchronize: false,
        // Apply pending migrations on boot so schema changes (e.g. projects.tx_cache)
        // land without a manual CLI step.
        migrations: [__dirname + '/migrations/*.{js,ts}'],
        migrationsRun: true,
        ssl: cfg.get<string>('DATABASE_URL', '').includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    ExplorerModule,
    ChainDataModule,
    AnalyticsModule,
    AiModule,
  ],
})
export class AppModule {}
