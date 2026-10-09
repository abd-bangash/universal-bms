import type {
  AIAdapter,
  HealthResult,
  IntegrationSecrets,
  StructuredRequest,
  TextRequest,
  TokenUsage,
} from '@bms/types';
import { ProviderHttpError } from '../integrations/adapter-runner';

export const ANTHROPIC_PROVIDER = 'ANTHROPIC';
const API_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';
/** Used when the workspace has not chosen a model. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
const STRUCTURED_TOOL = 'respond';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Anthropic's Messages API. A structured answer is asked for by giving the model one tool whose
 * input schema is the wanted shape and requiring it to be used; the tool input is the answer.
 * The key and model come from the workspace's stored credentials. The HTTP client is injectable so
 * tests can answer for the provider.
 */
export class AnthropicAdapter implements AIAdapter {
  readonly provider = ANTHROPIC_PROVIDER;

  constructor(
    private readonly secrets: IntegrationSecrets,
    private readonly http: typeof fetch = (...args) => fetch(...args),
    private readonly base: string = API_BASE,
  ) {}

  private get model(): string {
    return this.secrets['model']?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }

  async generateStructured<T>(
    req: StructuredRequest,
  ): Promise<{ data: T; usage: TokenUsage; model: string }> {
    const res = await this.call(
      {
        system: req.system,
        messages: req.messages,
        max_tokens: req.maxTokens,
        tools: [
          {
            name: STRUCTURED_TOOL,
            description: req.schemaName ?? 'Give the answer in the required structure.',
            input_schema: req.schema,
          },
        ],
        tool_choice: { type: 'tool', name: STRUCTURED_TOOL },
      },
      req.timeoutMs,
    );
    const block = arr(res['content'])
      .map(obj)
      .find((b) => b['type'] === 'tool_use' && b['name'] === STRUCTURED_TOOL);
    if (!block || typeof block['input'] !== 'object' || block['input'] === null) {
      throw new ProviderHttpError(502, 'The provider did not return a structured answer');
    }
    return { data: block['input'] as T, usage: usageOf(res), model: this.modelOf(res) };
  }

  async generateText(
    req: TextRequest,
  ): Promise<{ text: string; usage: TokenUsage; model: string }> {
    const res = await this.call(
      { system: req.system, messages: req.messages, max_tokens: req.maxTokens },
      req.timeoutMs,
    );
    const text = arr(res['content'])
      .map(obj)
      .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
      .map((b) => b['text'] as string)
      .join('');
    return { text, usage: usageOf(res), model: this.modelOf(res) };
  }

  /** A one-word question: proves the key works without spending anything worth counting. */
  async testConnection(): Promise<HealthResult> {
    const { model } = await this.generateText({
      system: 'Answer with the single word: ok',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      timeoutMs: 15_000,
    });
    return { ok: true, detail: model };
  }

  private modelOf(res: Json): string {
    return typeof res['model'] === 'string' ? res['model'] : this.model;
  }

  private async call(body: Json, timeoutMs: number): Promise<Json> {
    const res = await this.http(`${this.base}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.secrets['apiKey'] ?? '',
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new ProviderHttpError(res.status);
    return obj(await res.json());
  }
}

function usageOf(res: Json): TokenUsage {
  const usage = obj(res['usage']);
  return { inputTokens: num(usage['input_tokens']), outputTokens: num(usage['output_tokens']) };
}
