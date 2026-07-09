import { MigrationInterface, QueryRunner } from 'typeorm';

// Role column for users (RBAC: 'user' | 'admin').
export class AddUserRole1719400000000 implements MigrationInterface {
  name = 'AddUserRole1719400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar NOT NULL DEFAULT 'user'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
  }
}
