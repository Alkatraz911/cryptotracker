export type AiProvider = 'ollama' | 'claude' | 'openrouter' | 'openai';
export interface LlmRequest {
    system: string;
    prompt: string;
    maxTokens?: number;
}
export interface LlmResult {
    text: string;
    provider: AiProvider;
    model: string;
}
export declare class LlmProvider {
    private readonly logger;
    provider(): AiProvider;
    model(): string;
    configured(): boolean;
    complete(req: LlmRequest): Promise<LlmResult>;
    private completeClaude;
    private completeOpenAi;
    private completeOllama;
}
