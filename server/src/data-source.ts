import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './users/entities/user.entity';
import { Project } from './projects/entities/project.entity';
import { Wallet } from './chaindata/entities/wallet.entity';
import { Transaction } from './chaindata/entities/transaction.entity';
import { BridgeAddress } from './explorer/entities/bridge-address.entity';
import { UsageEvent } from './analytics/entities/usage-event.entity';
import { KnowledgeEntryEntity } from './ai/entities/knowledge-entry.entity';
import { ProviderHealthEntry } from './explorer/entities/provider-health.entity';

// Standalone DataSource for the TypeORM CLI (migration generate/run/revert).
// The running app configures TypeORM via TypeOrmModule in app.module.ts and runs
// migrations on boot (migrationsRun); this file exists so migrations can also be
// authored/applied via the CLI. Loads .env if dotenv is available.
try { (require('dotenv') as { config: () => void }).config(); } catch { /* env already set */ }

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Project, Wallet, Transaction, BridgeAddress, UsageEvent, KnowledgeEntryEntity, ProviderHealthEntry],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  ssl: (process.env.DATABASE_URL ?? '').includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});
