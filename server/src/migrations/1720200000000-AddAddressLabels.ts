import { MigrationInterface, QueryRunner } from 'typeorm';

// Shared address → entity-label registry (manual / OKX-copied / explorer tags).
export class AddAddressLabels1720200000000 implements MigrationInterface {
  name = 'AddAddressLabels1720200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "address_labels" (
        "address" varchar NOT NULL,
        "label" varchar NOT NULL,
        "source" varchar NOT NULL DEFAULT 'manual',
        "created_by" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_address_labels" PRIMARY KEY ("address")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "address_labels"`);
  }
}
