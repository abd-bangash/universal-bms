import { ProviderHttpError } from '../../integrations/adapter-runner';
import { AnthropicAdapter, DEFAULT_ANTHROPIC_MODEL } from '../anthropic.adapter';
import { FakeAIAdapter } from '../fake-ai.adapter';

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SCHEMA = { type: 'object', properties: { colour: { type: 'string' } }, required: ['colour'] };

function adapter(
  answer: () => Response,
  secrets: Record<string, string> = { apiKey: 'sk-test-1234' },
) {
  const http = jest.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    return answer();
  });
  return {
    adapter: new AnthropicAdapter(secrets, http as unknown as typeof fetch, 'https://ai.test/v1'),
    http,
  };
}

describe('AnthropicAdapter', () => {
  it('asks for a structured answer through a forced tool and returns its input with the usage', async () => {
    const { adapter: a, http } = adapter(() =>
      reply({
        model: 'claude-haiku-5-5-20260101',
        content: [{ type: 'tool_use', name: 'respond', input: { colour: 'brown' } }],
        usage: { input_tokens: 120, output_tokens: 30 },
      }),
    );
    const out = await a.generateStructured<{ colour: string }>({
      system: 'Extract.',
      messages: [{ role: 'user', content: 'brown leather sofa' }],
      schema: SCHEMA,
      schemaName: 'Requirements',
      maxTokens: 300,
      timeoutMs: 5000,
    });
    expect(out).toEqual({
      data: { colour: 'brown' },
      usage: { inputTokens: 120, outputTokens: 30 },
      model: 'claude-haiku-5-5-20260101',
    });
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ai.test/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test-1234',
      'anthropic-version': '2023-06-01',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: DEFAULT_ANTHROPIC_MODEL,
      system: 'Extract.',
      max_tokens: 300,
      messages: [{ role: 'user', content: 'brown leather sofa' }],
      tools: [{ name: 'respond', description: 'Requirements', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'respond' },
    });
  });

  it('uses the workspace model when one is set', async () => {
    const { adapter: a, http } = adapter(
      () => reply({ content: [{ type: 'text', text: 'ok' }], usage: {} }),
      { apiKey: 'k', model: 'claude-sonnet-5-5' },
    );
    const out = await a.generateText({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      timeoutMs: 1000,
    });
    expect(JSON.parse((http.mock.calls[0]?.[1] as RequestInit).body as string).model).toBe(
      'claude-sonnet-5-5',
    );
    expect(out).toEqual({
      text: 'ok',
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'claude-sonnet-5-5',
    });
  });

  it('joins the text blocks of a text answer', async () => {
    const { adapter: a } = adapter(() =>
      reply({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'tool_use' },
          { type: 'text', text: 'there' },
        ],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    expect(
      (await a.generateText({ system: 's', messages: [], maxTokens: 10, timeoutMs: 1000 })).text,
    ).toBe('Hello there');
  });

  it('rejects a structured call that did not come back as the tool input', async () => {
    const { adapter: a } = adapter(() =>
      reply({ content: [{ type: 'text', text: 'I think brown' }], usage: {} }),
    );
    await expect(
      a.generateStructured({
        system: 's',
        messages: [],
        schema: SCHEMA,
        maxTokens: 10,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it.each([
    [401, 401],
    [429, 429],
    [500, 500],
  ])('turns a %s answer into a ProviderHttpError for the runner to normalize', async (status) => {
    const { adapter: a } = adapter(() =>
      reply({ error: { message: 'sk-test-1234 is wrong' } }, status),
    );
    const err = await a
      .generateText({ system: 's', messages: [], maxTokens: 10, timeoutMs: 1000 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(status);
    expect((err as Error).message).not.toContain('sk-test'); // the provider's words, and our key, never travel on
  });

  it('tests the connection with a tiny question', async () => {
    const { adapter: a, http } = adapter(() =>
      reply({ model: 'm1', content: [{ type: 'text', text: 'ok' }], usage: {} }),
    );
    expect(await a.testConnection()).toEqual({ ok: true, detail: 'm1' });
    expect(JSON.parse((http.mock.calls[0]?.[1] as RequestInit).body as string).max_tokens).toBe(8);
  });
});

describe('FakeAIAdapter', () => {
  const req = {
    system: 's',
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 10,
    timeoutMs: 1000,
  };

  it('answers from the script in order and records every call', async () => {
    const fake = new FakeAIAdapter().structured({ a: 1 }).text('hello').failWith(new Error('boom'));
    expect((await fake.generateStructured({ ...req, schema: SCHEMA })).data).toEqual({ a: 1 });
    expect((await fake.generateText(req)).text).toBe('hello');
    await expect(fake.generateText(req)).rejects.toThrow('boom');
    expect(fake.calls.map((c) => c.kind)).toEqual(['structured', 'text', 'text']);
  });

  it('refuses to invent an answer when nothing is scripted, or when the kind does not match', async () => {
    const fake = new FakeAIAdapter();
    await expect(fake.generateText(req)).rejects.toThrow('no answer was scripted');
    fake.text('x');
    await expect(fake.generateStructured({ ...req, schema: SCHEMA })).rejects.toThrow(
      'text answer was scripted',
    );
  });

  it('can answer everything else from a function, and be reset', async () => {
    const fake = new FakeAIAdapter().otherwise((call) =>
      call.kind === 'text' ? { text: 'default' } : { structured: {} },
    );
    expect((await fake.generateText(req)).text).toBe('default');
    fake.reset();
    expect(fake.calls).toHaveLength(0);
    await expect(fake.generateText(req)).rejects.toThrow();
  });
});
