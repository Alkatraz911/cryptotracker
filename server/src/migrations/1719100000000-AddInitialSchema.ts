import { MigrationInterface, QueryRunner } from 'typeorm';

// Bootstrap schema: users + projects. Never had a migration of its own —
// earlier migrations (AddChainDataTables, AddUserRole) assumed these tables
// already existed, which only held on dev DBs that predated migrations.
export class AddInitialSchema1719100000000 implements MigrationInterface {
  name = 'AddInitialSchema1719100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar NOT NULL,
        "email" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "projects" (
        "id" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "name" varchar NOT NULL,
        "graph" jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        "tx_cache" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_projects_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_projects_user" ON "projects" ("user_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_projects_user"`);
    await q.query(`DROP TABLE IF EXISTS "projects"`);
    await q.query(`DROP TABLE IF EXISTS "users"`);
  }
}
