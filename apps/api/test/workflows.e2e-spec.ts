import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import fc from 'fast-check';
import { AppException } from '../src/common/errors/app.exception';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { WorkflowRegistry } from '../src/modules/workflows/workflow.registry';
import { WorkflowService } from '../src/modules/workflows/workflow.service';
import type {
  WorkflowActor,
  WorkflowEntityAdapter,
  WorkflowEntityType,
} from '../src/modules/workflows/workflow.types';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

/** An in-memory record store standing in for the Lead and Order tables (their modules come later). */
class FakeStore {
  states = new Map<string, string>();
  values = new Map<string, Record<string, unknown>>();
  adapter(
    entityType: WorkflowEntityType,
    event?: WorkflowEntityAdapter['event'],
  ): WorkflowEntityAdapter {
    return {
      entityType,
      event,
      load: async (_tx, id) =>
        this.states.has(id)
          ? { id, stateKey: this.states.get(id) as string, values: this.values.get(id) ?? {} }
          : null,
      setState: async (_tx, id, state) => {
        this.states.set(id, state.key);
      },
    };
  }
}


describe('Workflow engine (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let workflows: WorkflowService;
  let registry: WorkflowRegistry;
  let n = 0;
  const leads = new FakeStore();
  const orders = new FakeStore();

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
    workflows = app.get(WorkflowService);
    registry = app.get(WorkflowRegistry);
    registry.registerAdapter(leads.adapter('LEAD', 'lead.status_changed'));
    registry.registerAdapter(orders.adapter('ORDER', 'order.status_changed'));
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@wf.test`;
    const created = await app.get(TenantsService).createWorkspace({
      name: `WF ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    const me = (await http.get('/auth/me', login.body.data.accessToken)).body.data;
    return {
      ...created,
      token: login.body.data.accessToken as string,
      userId: me.user.id as string,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;
  const run = <T>(b: Biz, work: () => Promise<T>) =>
    runWithWorkspace(app, b.workspaceId, work, b.userId);
  const actorOf = (b: Biz, permissions: string[] = []): WorkflowActor => ({
    userId: b.userId,
    permissions,
  });
  const newLead = (state = 'new') => {
    const id = `lead_${Math.random().toString(36).slice(2)}`;
    leads.states.set(id, state);
    return id;
  };
  const newOrder = (state = 'draft') => {
    const id = `order_${Math.random().toString(36).slice(2)}`;
    orders.states.set(id, state);
    return id;
  };
  const history = (b: Biz, entityId: string) =>
    t.db.prisma.statusHistory.findMany({
      where: { workspaceId: b.workspaceId, entityId },
      orderBy: { createdAt: 'asc' },
    });
  const failure = async (promise: Promise<unknown>): Promise<AppException> => {
    try {
      await promise;
    } catch (err) {
      return err as AppException;
    }
    throw new Error('expected a failure');
  };

  describe('GET /workflows/:entityType', () => {
    it('returns the states, transitions and any missing System_Roles', async () => {
      const b = await business();
      const res = await http.get('/workflows/ORDER', b.token).expect(200);
      expect(res.body.data.states.map((s: Json) => s.key)).toEqual(
        expect.arrayContaining(['draft', 'confirmed', 'completed', 'cancelled']),
      );
      expect(res.body.data.transitions).toContainEqual(
        expect.objectContaining({
          from: 'draft',
          to: 'cancelled',
          requiredPermission: 'order:cancel',
        }),
      );
      expect(res.body.data.missingSystemRoles).toEqual([]);
      await http.get('/workflows/NOPE', b.token).expect(400);
      for (const type of ['LEAD', 'PURCHASE_ORDER', 'PRODUCTION_JOB'])
        await http.get(`/workflows/${type}`, b.token).expect(200);
    });

    it('is permission-gated, and reports a workflow that lost a required System_Role', async () => {
      const b = await business();
      const other = await business();
      await t.db.prisma.workflowState.updateMany({
        where: { workspaceId: b.workspaceId, systemRole: 'LOST', workflow: { entityType: 'LEAD' } },
        data: { systemRole: null },
      });
      const res = await http.get('/workflows/LEAD', b.token).expect(200);
      expect(res.body.data.missingSystemRoles).toEqual(['LOST']);
      expect((await http.get('/workflows/LEAD', other.token)).body.data.missingSystemRoles).toEqual(
        [],
      );

      const roles = (await http.get('/roles', b.token)).body.data as Json[];
      const cashier = roles.find((r) => r.name === 'Cashier') as Json;
      const invite = await http
        .post('/users/invite', { email: `c${n}@wf.test`, roleIds: [cashier.id] }, b.token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: invite.body.data.token,
          password: 'member-password-1',
          firstName: 'C',
          lastName: 'C',
        })
        .expect(200);
      const login = await http
        .post('/auth/login', { email: `c${n}@wf.test`, password: 'member-password-1' })
        .expect(200);
      await http.get('/workflows/ORDER', login.body.data.accessToken).expect(403);
    });
  });

  describe('transition()', () => {
    it('moves a record, writes history and audit, and publishes the event after the commit', async () => {
      const b = await business();
      const id = newLead();
      const seen: Json[] = [];
      const emitter = app.get(EventEmitter2);
      const listener = (p: Json) => seen.push(p);
      emitter.on('lead.status_changed', listener);
      try {
        const result = await run(b, () =>
          workflows.transition('LEAD', id, 'contacted', { actor: actorOf(b), note: 'Called them' }),
        );
        expect(result).toEqual({
          pendingApproval: false,
          entityId: id,
          from: 'new',
          to: 'contacted',
        });
      } finally {
        emitter.off('lead.status_changed', listener);
      }
      expect(leads.states.get(id)).toBe('contacted');
      const rows = await history(b, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'LEAD',
        fromKey: 'new',
        toKey: 'contacted',
        changedById: b.userId,
        note: 'Called them',
        actorType: 'USER',
      });
      expect(
        await t.db.prisma.auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'lead.status_changed', entityId: id },
        }),
      ).toBe(1);
      expect(seen).toEqual([
        expect.objectContaining({ leadId: id, workspaceId: b.workspaceId, actorUserId: b.userId }),
      ]);
    });

    it('answers 422 with the allowed target states when the move is not allowed, and changes nothing', async () => {
      const b = await business();
      const id = newOrder('draft');
      for (const target of ['completed', 'draft', 'ghost']) {
        const err = await failure(
          run(b, () =>
            workflows.transition('ORDER', id, target, { actor: actorOf(b, ['order:cancel']) }),
          ),
        );
        expect(err).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED' });
        expect(err.getStatus()).toBe(422);
        expect(err.details?.allowed).toEqual(
          expect.arrayContaining(['confirmed', 'on_hold', 'cancelled']),
        );
        expect((err.data as Json).allowed.length).toBeGreaterThan(0);
      }
      expect(orders.states.get(id)).toBe('draft');
      expect(await history(b, id)).toHaveLength(0);
      await expect(
        run(b, () => workflows.transition('ORDER', 'missing', 'confirmed', { actor: actorOf(b) })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('checks the permission named on the transition (27.5)', async () => {
      const b = await business();
      const id = newOrder('confirmed');
      const denied = await failure(
        run(b, () =>
          workflows.transition('ORDER', id, 'cancelled', { actor: actorOf(b, ['order:edit']) }),
        ),
      );
      expect(denied.code).toBe('PERMISSION_DENIED');
      expect(orders.states.get(id)).toBe('confirmed');
      await run(b, () =>
        workflows.transition('ORDER', id, 'cancelled', { actor: actorOf(b, ['order:cancel']) }),
      );
      expect(orders.states.get(id)).toBe('cancelled');
      // system and AI transitions are not blocked by a person's permission
      const other = newOrder('confirmed');
      await run(b, () =>
        workflows.transition('ORDER', other, 'cancelled', {
          actor: { userId: null, permissions: [], actorType: 'SYSTEM' },
        }),
      );
      expect((await history(b, other))[0]).toMatchObject({
        actorType: 'SYSTEM',
        changedById: null,
      });
    });

    it('requires the fields named on the transition before it happens (27.5)', async () => {
      const b = await business();
      await t.db.prisma.workflowTransition.updateMany({
        where: {
          workspaceId: b.workspaceId,
          workflow: { entityType: 'LEAD' },
          fromState: { key: 'new' },
          toState: { key: 'qualified' },
        },
        data: { requiredFields: ['budget'] },
      });
      const id = newLead();
      const missing = await failure(
        run(b, () => workflows.transition('LEAD', id, 'qualified', { actor: actorOf(b) })),
      );
      expect(missing).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(missing.getStatus()).toBe(422);
      expect(missing.details).toEqual({ budget: ['is required for this change'] });
      leads.values.set(id, { budget: '50000' });
      await run(b, () => workflows.transition('LEAD', id, 'qualified', { actor: actorOf(b) }));
      expect(leads.states.get(id)).toBe('qualified');
      // facts supplied with the request count too (for example a lost reason)
      const other = newLead();
      await t.db.prisma.workflowTransition.updateMany({
        where: {
          workspaceId: b.workspaceId,
          workflow: { entityType: 'LEAD' },
          fromState: { key: 'new' },
          toState: { key: 'lost' },
        },
        data: { requiredFields: ['lostReasonId'] },
      });
      await expect(
        run(b, () => workflows.transition('LEAD', other, 'lost', { actor: actorOf(b) })),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await run(b, () =>
        workflows.transition('LEAD', other, 'lost', {
          actor: actorOf(b),
          data: { lostReasonId: 'r1' },
        }),
      );
    });

    it('creates an approval request instead of moving when the transition needs approval (27.7)', async () => {
      const b = await business();
      await t.db.prisma.workflowTransition.updateMany({
        where: {
          workspaceId: b.workspaceId,
          workflow: { entityType: 'ORDER' },
          fromState: { key: 'draft' },
          toState: { key: 'confirmed' },
        },
        data: { requiresApproval: true },
      });
      const id = newOrder('draft');
      const pending = await run(b, () =>
        workflows.transition('ORDER', id, 'confirmed', {
          actor: actorOf(b, ['order:edit']),
          note: 'please',
        }),
      );
      expect(pending).toMatchObject({ pendingApproval: true, from: 'draft', to: 'confirmed' });
      expect(orders.states.get(id)).toBe('draft');
      expect(await history(b, id)).toHaveLength(0);
      const request = await t.db.prisma.approvalRequest.findFirstOrThrow({
        where: { workspaceId: b.workspaceId, entityId: id },
      });
      expect(request).toMatchObject({
        status: 'PENDING',
        entityType: 'ORDER',
        requestedById: b.userId,
      });
      expect(request.payload).toEqual({ from: 'draft', to: 'confirmed', note: 'please' });

      // an approver moves it directly; an approved decision applies it
      const direct = newOrder('draft');
      await run(b, () =>
        workflows.transition('ORDER', direct, 'confirmed', {
          actor: actorOf(b, ['order:approve']),
        }),
      );
      expect(orders.states.get(direct)).toBe('confirmed');
      await run(b, () =>
        workflows.transition('ORDER', id, 'confirmed', { actor: actorOf(b), approved: true }),
      );
      expect(orders.states.get(id)).toBe('confirmed');
    });

    it('runs the pre-conditions and side effects of the target System_Role, atomically', async () => {
      const b = await business();
      const log: string[] = [];
      registry.registerPrecondition('LEAD', 'WON', async (ctx) => {
        log.push(`pre:${ctx.from.key}->${ctx.to.key}`);
        if (ctx.data.blockWon) throw new AppException('DEPOSIT_REQUIRED', 422, 'Not yet');
      });
      registry.registerSideEffect('LEAD', 'WON', async (ctx) => {
        log.push(`effect:${ctx.record.id === ctx.record.id}`);
        if (ctx.data.breakEffect) throw new Error('side effect exploded');
      });

      const blocked = newLead('negotiation');
      const emitter = app.get(EventEmitter2);
      const seen: Json[] = [];
      const listener = (p: Json) => seen.push(p);
      emitter.on('lead.status_changed', listener);
      try {
        const err = await failure(
          run(b, () =>
            workflows.transition('LEAD', blocked, 'won', {
              actor: actorOf(b),
              data: { blockWon: true },
            }),
          ),
        );
        expect(err.code).toBe('DEPOSIT_REQUIRED');
        expect(log).toEqual(['pre:negotiation->won']);

        // a failing side effect rolls the history and audit back too; the in-memory state is the adapter's business
        const exploding = newLead('negotiation');
        await expect(
          run(b, () =>
            workflows.transition('LEAD', exploding, 'won', {
              actor: actorOf(b),
              data: { breakEffect: true },
            }),
          ),
        ).rejects.toThrow('exploded');
        expect(await history(b, exploding)).toHaveLength(0);
        expect(
          await t.db.prisma.auditEvent.count({
            where: { workspaceId: b.workspaceId, entityId: exploding },
          }),
        ).toBe(0);
        expect(seen).toHaveLength(0); // no event for a change that did not commit

        log.length = 0;
        const fine = newLead('negotiation');
        await run(b, () => workflows.transition('LEAD', fine, 'won', { actor: actorOf(b) }));
        expect(log).toEqual(['pre:negotiation->won', 'effect:true']);
        expect(seen).toHaveLength(1);
      } finally {
        emitter.off('lead.status_changed', listener);
      }
      // hooks are keyed by System_Role, not by key or label: renaming the state keeps the behaviour
      await t.db.prisma.workflowState.updateMany({
        where: { workspaceId: b.workspaceId, systemRole: 'WON' },
        data: { key: 'closed_won', label: 'Closed won' },
      });
      log.length = 0;
      const renamed = newLead('negotiation');
      await run(b, () =>
        workflows.transition('LEAD', renamed, 'closed_won', { actor: actorOf(b) }),
      );
      expect(log).toEqual(['pre:negotiation->closed_won', 'effect:true']);
    });

    it('only uses the workflow of its own workspace', async () => {
      const a = await business();
      const b = await business();
      await t.db.prisma.workflowState.updateMany({
        where: { workspaceId: a.workspaceId, key: 'contacted' },
        data: { active: false },
      });
      const id = newLead();
      await expect(
        run(a, () => workflows.transition('LEAD', id, 'contacted', { actor: actorOf(a) })),
      ).rejects.toMatchObject({ code: 'TRANSITION_NOT_ALLOWED' });
      await run(b, () => workflows.transition('LEAD', id, 'contacted', { actor: actorOf(b) }));
      expect(leads.states.get(id)).toBe('contacted');
    });
  });

  describe('Property 18 — workflow integrity (27.6, 27.10, 11.3)', () => {
    it("for any sequence of requests the state is always one of the workflow's, every change has a history row, and a refused request changes nothing", async () => {
      const b = await business();
      const workflow = await run(b, () => workflows.get('LEAD'));
      const keys = workflow.states.map((s) => s.key);
      const requestKeys = fc.constantFrom(...keys, 'ghost', '');

      await fc.assert(
        fc.asyncProperty(
          fc.array(requestKeys, { minLength: 1, maxLength: 8 }),
          async (requests) => {
            const id = newLead();
            let expectedChanges = 0;
            for (const target of requests) {
              const before = leads.states.get(id) as string;
              const historyBefore = (await history(b, id)).length;
              const allowed = workflow.transitions.some(
                (tr) => tr.from === before && tr.to === target,
              );
              let outcome: 'ok' | 'refused' = 'ok';
              try {
                await run(b, () => workflows.transition('LEAD', id, target, { actor: actorOf(b) }));
              } catch (err) {
                expect((err as AppException).code).toBe('TRANSITION_NOT_ALLOWED');
                outcome = 'refused';
              }
              expect(outcome).toBe(allowed ? 'ok' : 'refused');
              const after = leads.states.get(id) as string;
              expect(keys).toContain(after);
              const rows = await history(b, id);
              if (outcome === 'ok') {
                expectedChanges += 1;
                expect(after).toBe(target);
                expect(rows).toHaveLength(historyBefore + 1);
                expect(rows.at(-1)).toMatchObject({ fromKey: before, toKey: target });
              } else {
                expect(after).toBe(before);
                expect(rows).toHaveLength(historyBefore);
              }
            }
            expect((await history(b, id)).length).toBe(expectedChanges);
          },
        ),
        { numRuns: 100 },
      );
    }, 240_000);
  });
});
