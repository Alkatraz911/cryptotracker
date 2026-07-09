import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class AddBridgeAddresses1719300000000 implements MigrationInterface {
    name: string;
    up(q: QueryRunner): Promise<void>;
    down(q: QueryRunner): Promise<void>;
}
