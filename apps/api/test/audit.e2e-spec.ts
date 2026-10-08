import {
  Body,
  Controller,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Module,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import fc from 'fast-check';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { CommonModule } from '../src/common/common.module';
import { RequestContextModule, type RequestContext } from '../src/common/context/request-context';
import { PrismaModule } from '../src/common/prisma/prisma.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { LOGGER } from '../src/common/logging/app-logger';
import { HealthModule } from '../src/modules/health/health.module';
import { AuditModule } from '../src/modules/audit/audit.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { ensureWorkspace } from './helpers/tenant-factories';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';

/** Test-only stand-in for the auth guard of task 8: takes workspace and user from headers. */
@Injectable()
class HeaderContextGuard implements CanActivate {
  constructor(private readonly cls: ClsService<RequestContext>) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (req.headers['x-ws']) this.cls.set('workspaceId', req.headers['x-ws']);
    if (req.headers['x-user']) this.cls.set('userId', req.headers['x-user']);
    return true;
  }
}

/** A minimal state-changing service following the project rule: change + audit in one transaction. */
@Injectable()
class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(symbol: string, fail: boolean): Promise<string> {
    return this.prisma.scoped.$transaction(async (tx) => {
      const unit = await tx.unit.create({
        data: { workspaceId: 'ignored', name: symbol, symbol, dimension: 'count', toBase: '1' },
      });
      await this.audit.record(tx, {
        action: 'unit.create',
        entityType: 'Unit',
        entityId: unit.id,
        after: unit as unknown as Record<string, unknown>,
      });
      if (fail) throw new Error('rolled back');
      return unit.id;
    });
  }
}

@Controller('units')
class UnitsController {
  constructor(private readonly units: UnitsService) {}
  @Post() async create(@Body() body: { symbol: string }): Promise<{ id: string }> {
    return { id: await this.units.create(body.symbol, false) };
  }
}

@Module({
  imports: [RequestContextModule, CommonModule, HealthModule, PrismaModule, AuditModule],
  controllers: [UnitsController],
  providers: [UnitsService, { provide: APP_GUARD, useClass: HeaderContextGuard }],
})
class TestModule {}

describe('Audit module (real PostgreSQL)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let cls: ClsService<RequestContext>;
  let units: UnitsService;
  let audit: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' });
    await app.init();
    cls = app.get(ClsService);
    units = app.get(UnitsService);
    audit = app.get(AuditService);
    prisma = app.get(PrismaService);
    audit.sleep = async () => undefined;
    await ensureWorkspace(db.prisma, 'ws_1');
    await ensureWorkspace(db.prisma, 'ws_2');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  const inWs = <T>(ws: string, fn: () => Promise<T>, userId = 'user_1') =>
    cls.runWith(
      { workspaceId: ws, userId, requestId: 'req_1', ip: '10.0.0.1', userAgent: 'jest' },
      fn,
    );

  describe('record', () => {
    it('stores actor, context, diff and redacted state in the same transaction', async () => {
      await inWs('ws_1', () =>
        prisma.scoped.$transaction((tx) =>
          audit.record(tx, {
            action: 'user.update',
            entityType: 'User',
            entityId: 'u1',
            before: { name: 'A', passwordHash: 'old' },
            after: { name: 'B', passwordHash: 'new' },
            metadata: { reason: 'test' },
          }),
        ),
      );
      const row = await db.prisma.auditEvent.findFirstOrThrow({ where: { entityId: 'u1' } });
      expect(row).toMatchObject({
        workspaceId: 'ws_1',
        actorUserId: 'user_1',
        actorType: 'USER',
        action: 'user.update',
        entityType: 'User',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
        requestId: 'req_1',
        previousState: { name: 'A', passwordHash: '[REDACTED]' },
        newState: { name: 'B', passwordHash: '[REDACTED]' },
        metadata: { reason: 'test' },
      });
    });

    it('records system and AI actors without a user', async () => {
      await inWs('ws_1', () =>
        prisma.scoped.$transaction((tx) =>
          audit.record(tx, {
            action: 'lead.update',
            entityType: 'Lead',
            entityId: 'ai1',
            actor: { type: 'AI', userId: null },
            metadata: { source: 'AI' },
          }),
        ),
      );
      const row = await db.prisma.auditEvent.findFirstOrThrow({ where: { entityId: 'ai1' } });
      expect(row).toMatchObject({ actorType: 'AI', actorUserId: null });
    });

    it('refuses to run without a workspace', async () => {
      await expect(
        prisma.unscoped.$transaction((tx) =>
          audit.record(tx, { action: 'x', entityType: 'T', entityId: '1' }),
        ),
      ).rejects.toThrow(/workspace/);
    });
  });

  describe('Property 3 — audit completeness', () => {
    it('a committed change has an event with actor, entity and new state; a rolled-back change has none (100+ cases)', async () => {
      await fc.assert(
        fc.asyncProperty(fc.stringMatching(/^[a-z]{3,10}$/), fc.boolean(), async (name, fail) => {
          const symbol = `${name}_${Math.random().toString(36).slice(2, 8)}`;
          let id: string | undefined;
          await inWs('ws_1', async () => {
            try {
              id = await units.create(symbol, fail);
            } catch {
              /* rolled back */
            }
          });
          const unit = await db.prisma.unit.findFirst({ where: { workspaceId: 'ws_1', symbol } });
          const events = await db.prisma.auditEvent.findMany({
            where: {
              workspaceId: 'ws_1',
              action: 'unit.create',
              newState: { path: ['symbol'], equals: symbol },
            },
          });
          if (fail) {
            expect(unit).toBeNull();
            expect(events).toHaveLength(0);
          } else {
            expect(unit?.id).toBe(id);
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              actorUserId: 'user_1',
              entityType: 'Unit',
              entityId: id,
            });
          }
        }),
        { numRuns: 100 },
      );
    }, 120_000);
  });

  describe('recordAsync', () => {
    it('stores the event when there is no transaction', async () => {
      await inWs('ws_1', () =>
        audit.recordAsync({ action: 'auth.login_failed', entityType: 'User', entityId: 'async1' }),
      );
      expect(await db.prisma.auditEvent.count({ where: { entityId: 'async1' } })).toBe(1);
    });

    it('can target a workspace explicitly', async () => {
      await audit.recordAsync({
        workspaceId: 'ws_2',
        action: 'webhook.signature_failed',
        entityType: 'Webhook',
        entityId: 'async2',
        actor: { type: 'WEBHOOK', userId: null },
      });
      const row = await db.prisma.auditEvent.findFirstOrThrow({ where: { entityId: 'async2' } });
      expect(row).toMatchObject({ workspaceId: 'ws_2', actorType: 'WEBHOOK' });
    });

    it('retries three times, then logs an alert and does not throw', async () => {
      const logger = app.get<{ error: jest.Mock }>(LOGGER);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      const create = jest
        .spyOn(prisma.scoped.auditEvent, 'create')
        .mockRejectedValue(new Error('db down'));
      await expect(
        inWs('ws_1', () =>
          audit.recordAsync({ action: 'x.fail', entityType: 'T', entityId: 'fail1' }),
        ),
      ).resolves.toBeUndefined();
      expect(create).toHaveBeenCalledTimes(4); // first try + 3 retries
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ alert: 'audit_write_failed', action: 'x.fail' }),
        expect.any(String),
      );
      create.mockRestore();
      errorSpy.mockRestore();
    });

    it('succeeds when a retry works', async () => {
      const original = prisma.scoped.auditEvent.create.bind(prisma.scoped.auditEvent);
      let calls = 0;
      const spy = jest.spyOn(prisma.scoped.auditEvent, 'create').mockImplementation(((
        args: never,
      ) => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error('flaky'));
        return original(args);
      }) as never);
      await inWs('ws_1', () =>
        audit.recordAsync({ action: 'x.flaky', entityType: 'T', entityId: 'flaky1' }),
      );
      spy.mockRestore();
      expect(calls).toBe(3);
      expect(await db.prisma.auditEvent.count({ where: { entityId: 'flaky1' } })).toBe(1);
    });

    it('logs an alert when no workspace can be determined', async () => {
      const logger = app.get<{ error: jest.Mock }>(LOGGER);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      await audit.recordAsync({ action: 'x.none', entityType: 'T', entityId: 'none1' });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ alert: 'audit_write_failed' }),
        expect.any(String),
      );
      errorSpy.mockRestore();
    });
  });

  describe('GET /audit/events', () => {
    beforeAll(async () => {
      for (let i = 0; i < 7; i++) {
        await db.prisma.auditEvent.create({
          data: {
            workspaceId: 'ws_2',
            action: i % 2 ? 'order.create' : 'order.update',
            entityType: 'Order',
            entityId: `o${i}`,
            actorUserId: i < 3 ? 'actor_a' : 'actor_b',
            createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
          },
        });
      }
    });

    const get = (qs: string, ws = 'ws_2') =>
      request(app.getHttpServer()).get(`/api/v1/audit/events${qs}`).set('x-ws', ws);

    it('lists only the callers workspace, newest first', async () => {
      const res = await get('?entityType=Order&limit=100').expect(200);
      expect(res.body.data.map((e: { entityId: string }) => e.entityId)).toEqual([
        'o6',
        'o5',
        'o4',
        'o3',
        'o2',
        'o1',
        'o0',
      ]);
      const other = await get('?entityType=Order&limit=100', 'ws_1').expect(200);
      expect(other.body.data).toEqual([]);
    });

    it('filters by entity, actor, action and date range', async () => {
      const byActor = await get('?actorUserId=actor_a').expect(200);
      expect(byActor.body.data).toHaveLength(3);
      const byAction = await get('?action=order.create&entityType=Order').expect(200);
      expect(byAction.body.data.every((e: { action: string }) => e.action === 'order.create')).toBe(
        true,
      );
      const byEntity = await get('?entityType=Order&entityId=o4').expect(200);
      expect(byEntity.body.data).toHaveLength(1);
      const range = await get(
        '?entityType=Order&from=2026-01-03T00:00:00Z&to=2026-01-05T00:00:00Z',
      ).expect(200);
      expect(range.body.data.map((e: { entityId: string }) => e.entityId)).toEqual([
        'o4',
        'o3',
        'o2',
      ]);
    });

    it('paginates with an opaque cursor and no duplicates', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await get(
          `?entityType=Order&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        ).expect(200);
        seen.push(...res.body.data.map((e: { entityId: string }) => e.entityId));
        cursor = res.body.meta.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(['o6', 'o5', 'o4', 'o3', 'o2', 'o1', 'o0']);
    });

    it('rejects bad parameters with field errors', async () => {
      const res = await get('?limit=1000&from=yesterday&cursor=garbage').expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.details)).toEqual(expect.arrayContaining(['limit', 'from']));
      const bad = await get('?cursor=garbage').expect(400);
      expect(bad.body.details.cursor).toBeDefined();
    });

    it('returns ISO timestamps and the stored states', async () => {
      const res = await get('?entityType=Order&entityId=o0').expect(200);
      expect(res.body.data[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
