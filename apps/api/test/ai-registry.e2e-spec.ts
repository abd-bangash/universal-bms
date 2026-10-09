import { AIRegistry } from '../src/modules/ai/ai.registry';
import { AnthropicAdapter } from '../src/modules/ai/anthropic.adapter';
import { FakeAIAdapter } from '../src/modules/ai/fake-ai.adapter';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../src/common/context/request-context';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const KEY = 'sk-ant-test-key-9876';

describe('AI provider and registry', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let token: string;
  let workspaceId: string;
  let registry: AIRegistry;
  const inWorkspace = <T>(fn: () => Promise<T>) =>
    t.app.get<ClsService<RequestContext>>(ClsService).runWith({ workspaceId }, fn);

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    registry = t.app.get(AIRegistry);
    const email = 'owner@ai-registry.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'AI Registry',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    token = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    workspaceId = (await t.db.prisma.workspace.findFirstOrThrow({ where: { name: 'AI Registry' } }))
      .id;
  }, 90_000);
  afterAll(() => t.close());
  afterEach(() => {
    registry.useAdapter(null);
    jest.restoreAllMocks();
  });

  it('offers Anthropic as an AI service whose key is stored encrypted and shown masked', async () => {
    const catalogue = (await http.get('/integrations', token).expect(200)).body.data
      .providers as Json[];
    const provider = catalogue.find((p) => p.provider === 'ANTHROPIC');
    expect(provider).toMatchObject({ type: 'AI', label: 'Anthropic (Claude)' });
    expect(provider?.fields.map((f: Json) => [f.key, f.secret])).toEqual([
      ['apiKey', true],
      ['model', false],
    ]);

    const connected = (
      await http
        .post('/integrations', { provider: 'ANTHROPIC', values: { apiKey: KEY } }, token)
        .expect(201)
    ).body.data as Json;
    expect(connected.fields.find((f: Json) => f.key === 'apiKey').value).toBe('••••9876');
    expect(JSON.stringify(connected)).not.toContain(KEY);
    const row = await t.db.prisma.integrationConnection.findUniqueOrThrow({
      where: { id: connected.id },
    });
    expect(row.configEncrypted).not.toContain(KEY);
    await http.post('/integrations', { provider: 'ANTHROPIC', values: {} }, token).expect(400); // the key is required
  });

  it('tests the connection through the provider and reports the result', async () => {
    const spy = jest
      .spyOn(AnthropicAdapter.prototype, 'testConnection')
      .mockResolvedValue({ ok: true, detail: 'claude-haiku-5-5' });
    const id = ((await http.get('/integrations', token)).body.data.connections as Json[]).find(
      (c) => c.provider === 'ANTHROPIC',
    )?.id as string;
    expect((await http.post(`/integrations/${id}/test`, {}, token).expect(200)).body.data).toEqual({
      ok: true,
      detail: 'claude-haiku-5-5',
    });
    expect(spy).toHaveBeenCalled();
  });

  it('says AI is unavailable until a provider is chosen and connected', async () => {
    await expect(inWorkspace(() => registry.adapter())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'No AI provider has been chosen',
    });
    await http.patch('/settings', { ai: { provider: 'NOPE' } }, token).expect(200);
    await expect(inWorkspace(() => registry.adapter())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'The chosen AI provider is not available',
    });
  });

  it('builds the adapter from the stored key and the workspace model', async () => {
    await http
      .patch('/settings', { ai: { provider: 'ANTHROPIC', model: 'claude-sonnet-5-5' } }, token)
      .expect(200);
    const adapter = await inWorkspace(() => registry.adapter());
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
    const secrets = (adapter as unknown as { secrets: Record<string, string> }).secrets;
    expect(secrets).toMatchObject({ apiKey: KEY, model: 'claude-sonnet-5-5' });
  });

  it('is unavailable again once the provider is disconnected', async () => {
    const id = ((await http.get('/integrations', token)).body.data.connections as Json[]).find(
      (c) => c.provider === 'ANTHROPIC',
    )?.id as string;
    await http.post(`/integrations/${id}/disconnect`, {}, token).expect(200);
    await expect(inWorkspace(() => registry.adapter())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'The AI provider is not connected',
    });
  });

  it('lets a test answer for the provider with the fake adapter', async () => {
    const fake = new FakeAIAdapter().text('hi');
    registry.useAdapter(fake);
    const adapter = await inWorkspace(() => registry.adapter());
    expect(
      (await adapter.generateText({ system: 's', messages: [], maxTokens: 5, timeoutMs: 100 }))
        .text,
    ).toBe('hi');
    expect(registry.providers()).toContain('ANTHROPIC');
  });
});
