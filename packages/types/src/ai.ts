/** A JSON Schema document describing the shape a structured AI answer must have. */
export type JsonSchema = Record<string, unknown>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  system: string;
  messages: ChatMessage[];
  schema: JsonSchema;
  /** What the answer is, in a few words (providers that need a name for the structured answer use it). */
  schemaName?: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
}

/**
 * What every AI provider implements (design.md, AI). An adapter knows nothing about leads, prices or
 * permissions: it turns a prompt into text or JSON and reports what it cost. Everything it throws is
 * normalized by the AdapterRunner before any other code sees it.
 */
export interface AIAdapter {
  readonly provider: string;
  generateStructured<T>(
    req: StructuredRequest,
  ): Promise<{ data: T; usage: TokenUsage; model: string }>;
  generateText(req: TextRequest): Promise<{ text: string; usage: TokenUsage; model: string }>;
}
