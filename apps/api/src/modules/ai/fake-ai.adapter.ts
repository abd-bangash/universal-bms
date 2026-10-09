import type { AIAdapter, StructuredRequest, TextRequest, TokenUsage } from '@bms/types';

export interface FakeCall {
  kind: 'structured' | 'text';
  system: string;
  messages: Array<{ role: string; content: string }>;
  schema?: Record<string, unknown>;
}

type Scripted =
  | { structured: unknown; usage?: TokenUsage }
  | { text: string; usage?: TokenUsage }
  | { error: Error };

const DEFAULT_USAGE: TokenUsage = { inputTokens: 100, outputTokens: 40 };

/**
 * A provider that answers from a script, for tests and for trying the screens with no key.
 * It never invents an answer: a call with nothing scripted fails loudly, so a test cannot pass
 * by accident on a made-up reply. Every call is recorded.
 */
export class FakeAIAdapter implements AIAdapter {
  readonly provider = 'FAKE';
  readonly calls: FakeCall[] = [];
  private readonly script: Scripted[] = [];
  private fallback: ((call: FakeCall) => Scripted) | null = null;

  /** Queue the answers for the next calls, in order. */
  structured(data: unknown, usage?: TokenUsage): this {
    this.script.push({ structured: data, ...(usage ? { usage } : {}) });
    return this;
  }

  text(text: string, usage?: TokenUsage): this {
    this.script.push({ text, ...(usage ? { usage } : {}) });
    return this;
  }

  failWith(error: Error): this {
    this.script.push({ error });
    return this;
  }

  /** Answer every call that has no queued answer by asking this function. */
  otherwise(fn: (call: FakeCall) => Scripted): this {
    this.fallback = fn;
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.script.length = 0;
    this.fallback = null;
  }

  async generateStructured<T>(req: StructuredRequest) {
    const next = this.next({
      kind: 'structured',
      system: req.system,
      messages: req.messages,
      schema: req.schema,
    });
    if ('error' in next) throw next.error;
    if (!('structured' in next))
      throw new Error('FakeAIAdapter: a text answer was scripted for a structured call');
    return { data: next.structured as T, usage: next.usage ?? DEFAULT_USAGE, model: 'fake-model' };
  }

  async generateText(req: TextRequest) {
    const next = this.next({ kind: 'text', system: req.system, messages: req.messages });
    if ('error' in next) throw next.error;
    if (!('text' in next))
      throw new Error('FakeAIAdapter: a structured answer was scripted for a text call');
    return { text: next.text, usage: next.usage ?? DEFAULT_USAGE, model: 'fake-model' };
  }

  private next(call: FakeCall): Scripted {
    this.calls.push(call);
    const queued = this.script.shift();
    if (queued) return queued;
    if (this.fallback) return this.fallback(call);
    throw new Error('FakeAIAdapter: no answer was scripted for this call');
  }
}
