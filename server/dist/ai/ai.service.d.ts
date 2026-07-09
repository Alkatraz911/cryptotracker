import { LlmProvider } from './llm.provider';
import { KnowledgeService } from './knowledge.service';
export interface AiNode {
    id: string;
    kind: string;
    label?: string;
    address?: string | null;
    net?: string | null;
    nets?: string[] | null;
    entityName?: string | null;
    tag?: string | null;
    note?: string | null;
    amount?: number | null;
    coin?: string | null;
    chainName?: string | null;
}
export interface AiEdge {
    source: string;
    target: string;
    type?: string;
}
export interface AnalyzeInput {
    focusId?: string;
    nodes: AiNode[];
    edges: AiEdge[];
    question?: string;
}
export interface RiskSignal {
    id: string;
    label: string;
    severity: 'info' | 'warn' | 'high';
}
export interface AnalyzeResult {
    narrative: string;
    signals: RiskSignal[];
    used: {
        provider: string;
        model: string;
        knowledge: number;
        nodes: number;
        edges: number;
    };
    diag: string | null;
}
export declare class AiService {
    private readonly llm;
    private readonly knowledge;
    private readonly logger;
    constructor(llm: LlmProvider, knowledge: KnowledgeService);
    health(): {
        provider: import("./llm.provider").AiProvider;
        model: string;
        configured: boolean;
        knowledge: number;
    };
    analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
    private computeSignals;
    private buildFacts;
    private buildKnowledgeBlock;
}
