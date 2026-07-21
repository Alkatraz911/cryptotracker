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
import { KnowledgeEntryEntity } from './ai/entities/knowledge-entry.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        entities: [User, Project, Wallet, Transaction, BridgeAddress, UsageEvent, KnowledgeEntryEntity],
        synchronize: false,
        migrations: [__dirname + '/migrations/*.{js,ts}'],
        // Vercel sets VERCEL=1 in both its build and runtime environments. Under
        // Vercel, migrations run ONCE per deploy via the Build Command
        // (`npm run build && npm run migration:run` — see DEPLOYMENT.md), not
        // inside every serverless invocation: running migrationsRun:true on every
        // cold start is a race risk with concurrent cold starts and adds latency
        // to the first request of each one. Outside Vercel (local/`node dist/main`),
        // behavior is unchanged — migrations still auto-run on boot.
        migrationsRun: !process.env.VERCEL,
        ssl: cfg.get<string>('DATABASE_URL', '').includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : false,
        // Each concurrent serverless invocation opens its own connection pool
        // against Postgres; keep each pool small and pair with a pooled/pgbouncer
        // connection string from the managed Postgres provider (Neon/Supabase
        // both offer one — see DEPLOYMENT.md). Harmless for local/non-Vercel use.
        extra: { max: 5 },
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
