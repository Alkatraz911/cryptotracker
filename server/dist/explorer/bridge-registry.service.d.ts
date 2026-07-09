import { Repository } from 'typeorm';
import { BridgeAddress } from './entities/bridge-address.entity';
import type { BridgeName } from './explorer.service';
export interface BridgeEntry {
    bridge: BridgeName;
    name: string;
}
export declare class BridgeRegistryService {
    private readonly repo;
    private cache;
    private loadedAt;
    private static readonly TTL;
    constructor(repo: Repository<BridgeAddress>);
    private map;
    forAddress(address?: string | null): Promise<BridgeEntry | undefined>;
    list(): Promise<BridgeAddress[]>;
    add(entry: {
        address: string;
        bridge: BridgeName;
        name: string;
    }): Promise<BridgeAddress>;
    remove(address: string): Promise<void>;
}
