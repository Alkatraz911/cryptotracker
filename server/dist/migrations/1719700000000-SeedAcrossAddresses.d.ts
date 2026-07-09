import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class SeedAcrossAddresses1719700000000 implements MigrationInterface {
    name: string;
    private readonly seed;
    up(q: QueryRunner): Promise<void>;
    down(q: QueryRunner): Promise<void>;
}
