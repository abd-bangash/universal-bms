import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { RequestContext } from '../../common/context/request-context';
import { ENV, type Env } from '../../config/env';
import { LOGGER } from '../../common/logging/app-logger';
import { ReadinessRegistry } from '../health/readiness';
import { QueueRegistry } from './queue.registry';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_NAMES,
  type DeadLetter,
  type JobPayload,
  type ProcessorDefinition,
  type QueueName,
  type QueueStats,
} from './queue.types';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 2000;

export interface AddOptions {
  /** A job with an id already waiting or done is not added twice. */
  jobId?: string;
  /** Wait this long before the job becomes ready (milliseconds). */
  delayMs?: number;
}

/**
 * Background jobs on BullMQ (design.md, Background Jobs). A job carries its workspace, and its
 * processor runs inside that workspace's context. In `inline` mode (tests and tools without
 * Redis) the processor runs at once in the caller's process with the same retry and dead-letter
 * rules, so behaviour does not depend on a running Redis.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private connection?: IORedis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly started = new Set<string>();
  private readonly inlineDead: DeadLetter[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly registry: QueueRegistry,
    private readonly cls: ClsService<RequestContext>,
    private readonly readiness: ReadinessRegistry,
  ) {}

  private get inline(): boolean {
    return this.env.QUEUE_MODE === 'inline';
  }

  onModuleInit(): void {
    if (this.inline) return;
    this.readiness.register({
      name: 'redis',
      check: async () => {
        // an unreachable Redis must fail the check, not hang the health endpoint
        const reply = await Promise.race([
          this.redis().ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Redis did not answer in time')), 2000),
          ),
        ]);
        if (reply !== 'PONG') throw new Error('Redis did not answer');
      },
    });
  }

  /** Workers start with the application unless WORKERS_IN_PROCESS is off (a separate worker process then does the work). */
  onApplicationBootstrap(): void {
    if (this.inline || !this.env.WORKERS_IN_PROCESS) return;
    this.startWorkers();
  }

  /** Starts a worker for every registered processor that has none yet. */
  startWorkers(): void {
    if (this.inline) return;
    for (const def of this.registry.all()) {
      if (!this.started.has(def.queue)) {
        this.started.add(def.queue);
        this.startWorker(def);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection?.disconnect();
  }

  // ── producing ───────────────────────────────────────────────────────────────────────────

  async add(
    queue: QueueName,
    jobName: string,
    payload: JobPayload,
    options: AddOptions = {},
  ): Promise<void> {
    if (!payload.workspaceId) throw new Error('A job needs the workspace it is for');
    const def = this.registry.get(queue);
    if (this.inline) {
      if (def) await this.runInline(def, jobName, payload);
      return;
    }
    await this.queue(queue).add(jobName, payload, {
      attempts: def?.attempts ?? DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential', delay: def?.backoffMs ?? DEFAULT_BACKOFF_MS },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });
  }

  // ── looking at the queues ───────────────────────────────────────────────────────────────

  async stats(): Promise<Record<string, QueueStats>> {
    if (this.inline) {
      return Object.fromEntries(
        [...QUEUE_NAMES, DEAD_LETTER_QUEUE].map((q) => [
          q,
          {
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: q === DEAD_LETTER_QUEUE ? this.inlineDead.length : 0,
          },
        ]),
      );
    }
    const entries = await Promise.all(
      [...QUEUE_NAMES, DEAD_LETTER_QUEUE].map(async (name) => {
        const counts = await this.queue(name).getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
        );
        return [
          name,
          {
            waiting: counts['waiting'] ?? 0,
            active: counts['active'] ?? 0,
            delayed: counts['delayed'] ?? 0,
            failed: counts['failed'] ?? 0,
          },
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async deadLetters(limit = 50): Promise<DeadLetter[]> {
    if (this.inline) return this.inlineDead.slice(-limit).reverse();
    const jobs = await this.queue(DEAD_LETTER_QUEUE).getJobs(
      ['waiting', 'delayed', 'completed'],
      0,
      limit - 1,
    );
    return jobs.map((j) => j.data as DeadLetter);
  }

  /** Waits until a queue has nothing waiting, delayed or running (tests, and shutdown). */
  async idle(queue: QueueName, timeoutMs = 10_000): Promise<void> {
    if (this.inline) return;
    const q = this.queue(queue);
    const until = Date.now() + timeoutMs;
    for (;;) {
      const c = await q.getJobCounts('waiting', 'active', 'delayed');
      if ((c['waiting'] ?? 0) + (c['active'] ?? 0) + (c['delayed'] ?? 0) === 0) return;
      if (Date.now() > until) throw new Error(`Queue ${queue} did not become idle`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ── running ─────────────────────────────────────────────────────────────────────────────

  private startWorker(def: ProcessorDefinition): void {
    const worker = new Worker(
      def.queue,
      (job: Job<JobPayload>) => this.execute(def, job.name, job.data, job.attemptsMade),
      {
        connection: this.redis(),
        prefix: this.env.QUEUE_PREFIX,
        concurrency: def.concurrency ?? 5,
      },
    );
    worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? DEFAULT_ATTEMPTS;
      if (job.attemptsMade < attempts) {
        this.logger.warn(
          { queue: def.queue, job: job.name, attempt: job.attemptsMade, err },
          'job failed; will retry',
        );
        return;
      }
      void this.deadLetter({
        queue: def.queue,
        jobName: job.name,
        payload: job.data,
        error: err.message,
        attempts: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });
    });
    worker.on('error', (err) => this.logger.error({ err, queue: def.queue }, 'worker error'));
    this.workers.push(worker);
  }

  /** Runs one job inside its workspace's context. */
  private execute(
    def: ProcessorDefinition,
    name: string,
    payload: JobPayload,
    attemptsMade: number,
  ): Promise<void> {
    return this.cls.runWith(
      { workspaceId: payload.workspaceId, userId: payload.actorUserId ?? undefined },
      () => def.handler(payload, { name, attemptsMade }),
    );
  }

  private async runInline(
    def: ProcessorDefinition,
    name: string,
    payload: JobPayload,
  ): Promise<void> {
    const attempts = def.attempts ?? DEFAULT_ATTEMPTS;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.execute(def, name, payload, attempt);
        return;
      } catch (err) {
        lastError = err;
        this.logger.warn({ queue: def.queue, job: name, attempt, err }, 'job failed');
      }
    }
    await this.deadLetter({
      queue: def.queue,
      jobName: name,
      payload,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      attempts,
      failedAt: new Date().toISOString(),
    });
  }

  private async deadLetter(entry: DeadLetter): Promise<void> {
    this.logger.error(
      {
        queue: entry.queue,
        job: entry.jobName,
        workspaceId: entry.payload.workspaceId,
        error: entry.error,
      },
      'job moved to the dead-letter queue',
    );
    if (this.inline) {
      this.inlineDead.push(entry);
      return;
    }
    await this.queue(DEAD_LETTER_QUEUE).add('dead', entry, {
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  private redis(): IORedis {
    this.connection ??= new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    return this.connection;
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis(), prefix: this.env.QUEUE_PREFIX });
      this.queues.set(name, q);
    }
    return q;
  }
}
