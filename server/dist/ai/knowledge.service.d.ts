import { OnModuleInit } from '@nestjs/common';
export type KnowledgeKind = 'address' | 'pattern' | 'feedback';
export interface KnowledgeEntry {
    id: string;
    kind: KnowledgeKind;
    network?: string | null;
    address?: string | null;
    title: string;
    content: string;
    weight: number;
    source?: string | null;
    createdAt: string;
}
export declare class KnowledgeService implements OnModuleInit {
    private readonly logger;
    private entries;
    private readonly file;
    onModuleInit(): Promise<void>;
    private materialize;
    private persist;
    list(): KnowledgeEntry[];
    add(e: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'weight'> & {
        weight?: number;
    }): Promise<KnowledgeEntry>;
    remove(id: string): Promise<boolean>;
    retrieve(addresses: string[], limitGuidance?: number): KnowledgeEntry[];
    recordFeedback(opts: {
        rating: 'up' | 'down';
        correction?: string;
        focusAddress?: string | null;
        focusNetwork?: string | null;
    }): Promise<KnowledgeEntry | null>;
}
