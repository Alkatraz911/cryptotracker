import { AiService, AnalyzeInput } from './ai.service';
import { KnowledgeService } from './knowledge.service';
export declare class AiController {
    private readonly ai;
    private readonly knowledge;
    constructor(ai: AiService, knowledge: KnowledgeService);
    health(): {
        provider: import("./llm.provider").AiProvider;
        model: string;
        configured: boolean;
        knowledge: number;
    };
    analyze(body: AnalyzeInput): Promise<import("./ai.service").AnalyzeResult> | {
        narrative: string;
        signals: never[];
        used: null;
        diag: string;
    };
    feedback(body: {
        rating: 'up' | 'down';
        correction?: string;
        focusAddress?: string;
        focusNetwork?: string;
    }): Promise<{
        ok: boolean;
        stored: boolean;
    }>;
    listKnowledge(): {
        entries: import("./knowledge.service").KnowledgeEntry[];
    };
    addKnowledge(body: {
        kind: 'address' | 'pattern';
        network?: string;
        address?: string;
        title: string;
        content: string;
        weight?: number;
    }): Promise<{
        ok: boolean;
        entry: import("./knowledge.service").KnowledgeEntry;
    }> | {
        ok: boolean;
        error: string;
    };
    removeKnowledge(id: string): Promise<{
        ok: boolean;
    }>;
}
