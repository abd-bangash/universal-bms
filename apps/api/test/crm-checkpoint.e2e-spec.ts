import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** Checkpoint 30: the CRM journey from the task list, end to end through the HTTP API. */
describe('Checkpoint — CRM', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  it('a lead with custom sofa requirements moves through the pipeline, gets a follow-up and becomes a customer; the timeline shows every step', async () => {
    const email = 'owner@crm-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'CRM Checkpoint',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const salesRole = roles.find((r) => r.name === 'Salesperson') as Json;
    const invite = await http
      .post('/users/invite', { email: 'sam@crm-checkpoint.test', roleIds: [salesRole.id] }, token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: 'Sam',
        lastName: 'Seller',
      })
      .expect(200);
    const sales = (
      await http
        .post('/auth/login', { email: 'sam@crm-checkpoint.test', password: 'member-password-1' })
        .expect(200)
    ).body.data.accessToken as string;
    const samId = (await http.get('/auth/me', sales)).body.data.user.id as string;

    // 1. a lead with custom sofa requirements (the furniture profile's LEAD fields)
    const created = await http
      .post(
        '/leads',
        {
          fullName: 'Checkpoint Sana',
          phone: '0300-4440001',
          source: 'SOCIAL',
          channel: 'INSTAGRAM',
          interest: 'Corner sofa for a small lounge',
          requirements: 'Grey washable fabric',
          estimatedValue: '150000.00',
          priority: 'HIGH',
          customFields: {
            size_type: 'custom',
            length: { value: '9', unit: 'ft' },
            width: { value: '6', unit: 'ft' },
            height: { value: '34', unit: 'in' },
            material: 'fabric',
            color: 'Grey',
            customization_notes: 'Left-hand corner, high back',
          },
        },
        token,
      )
      .expect(201);
    const lead = created.body.data as Json;
    expect(lead.customFields).toMatchObject({
      size_type: 'custom',
      width: { value: '6', unit: 'ft' },
    });

    // 2. assigned to the salesperson, then moved through the pipeline
    await http.post(`/leads/${lead.id}/assign`, { assignedToId: samId }, token).expect(200);
    for (const stage of ['contacted', 'qualified', 'quoted', 'negotiation']) {
      await http
        .post(`/leads/${lead.id}/stage`, { stage, note: `Moved to ${stage}` }, sales)
        .expect(200);
    }

    // 3. a follow-up: the lead's next action creates a task for the salesperson
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await http
      .patch(
        `/leads/${lead.id}`,
        {
          version: (await http.get(`/leads/${lead.id}`, sales)).body.data.version,
          nextAction: 'Send the final offer',
          nextActionDate: due,
        },
        sales,
      )
      .expect(200);
    const tasks = (await http.get(`/tasks?entityType=LEAD&entityId=${lead.id}`, sales).expect(200))
      .body.data as Json[];
    expect(tasks).toEqual([
      expect.objectContaining({
        type: 'FOLLOW_UP',
        title: 'Send the final offer',
        assignedToId: samId,
        status: 'OPEN',
      }),
    ]);
    await http
      .post(
        '/notes',
        {
          entityType: 'LEAD',
          entityId: lead.id,
          kind: 'CALL',
          body: 'Agreed the price in principle',
          callDirection: 'OUTBOUND',
          callOutcome: 'ANSWERED',
        },
        sales,
      )
      .expect(201);

    // 4. won, then converted to a customer
    await http.post(`/leads/${lead.id}/stage`, { stage: 'won' }, sales).expect(200);
    const converted = await http
      .post(`/leads/${lead.id}/convert`, { target: 'CUSTOMER' }, sales)
      .expect(200);
    expect(converted.body.data).toMatchObject({
      created: true,
      customer: { fullName: 'Checkpoint Sana' },
    });
    const customerId = converted.body.data.customer.id as string;
    // the won lead no longer nags
    expect(
      (await http.get(`/tasks?entityType=LEAD&entityId=${lead.id}`, sales)).body.data as Json[],
    ).toEqual([]);
    expect(
      (await http.get(`/tasks?entityType=LEAD&entityId=${lead.id}&status=CANCELLED`, sales)).body
        .data as Json[],
    ).toHaveLength(1);

    // 5. the lead's timeline shows every step, oldest to newest
    const leadTimeline = (
      (await http.get(`/leads/${lead.id}/timeline?limit=100`, sales).expect(200)).body
        .data as Json[]
    )
      .map((e) => e.summary)
      .reverse();
    const expectedInOrder = [
      'Lead created',
      'Assigned to Sam Seller',
      'Stage changed from New to Contacted: Moved to contacted',
      'Stage changed from Contacted to Qualified: Moved to qualified',
      'Stage changed from Qualified to Quoted: Moved to quoted',
      'Stage changed from Quoted to Negotiation: Moved to negotiation',
      'Next action changed from empty to "Send the final offer"',
      'Call (outgoing, answered): Agreed the price in principle',
      'Stage changed from Negotiation to Won',
      'Converted to a new customer',
    ];
    let cursor = 0;
    for (const summary of leadTimeline)
      if (summary.startsWith(expectedInOrder[cursor] ?? '\u0000')) cursor += 1;
    expect({ missing: expectedInOrder.slice(cursor) }).toEqual({ missing: [] });
    expect(leadTimeline.some((s) => s.startsWith('Assigned to'))).toBe(true);

    // 6. and the new customer's timeline carries the lead's whole story
    const customerTimeline = (
      (await http.get(`/customers/${customerId}/timeline?limit=100`, sales).expect(200)).body
        .data as Json[]
    ).map((e) => e.summary);
    expect(customerTimeline).toEqual(
      expect.arrayContaining([
        'Lead created',
        'Converted to a new customer',
        'Customer record created',
        'Stage changed from Negotiation to Won',
      ]),
    );

    // 7. nothing leaks to another business
    const otherEmail = 'other@crm-checkpoint.test';
    await t.app.get(TenantsService).createWorkspace({
      name: 'Other',
      industryProfile: 'furniture',
      owner: { email: otherEmail, firstName: 'X', lastName: 'Y', password: 'owner-password-1' },
      country: 'PK',
    });
    const other = (
      await http
        .post('/auth/login', { email: otherEmail, password: 'owner-password-1' })
        .expect(200)
    ).body.data.accessToken as string;
    await http.get(`/leads/${lead.id}`, other).expect(404);
    await http.get(`/customers/${customerId}/timeline`, other).expect(404);
    expect((await http.get('/search?q=Checkpoint', other)).body.data.groups).toEqual([]);
    expect(
      (await http.get('/search?q=Checkpoint', token)).body.data.groups.map((g: Json) => g.type),
    ).toEqual(['CUSTOMER', 'LEAD']);
  });
});
