import { Inject, Injectable } from '@nestjs/common';
import {
  BrokenCircuitError,
  CircuitState,
  ConsecutiveBreaker,
  TaskCancelledError,
  circuitBreaker,
  handleAll,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
  type CircuitBreakerPolicy,
  type IPolicy,
} from 'cockatiel';
import { ClsService } from 'nestjs-cls';
import type { Logger } from 'pino';
import type { RequestContext } from '../../common/context/request-context';
import { ExternalServiceException } from '../../common/errors/app.exception';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** What an adapter throws when the provider answered with an error status. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message = `Provider answered ${status}`,
  ) {
    super(message);
  }
}

export type NormalizedCode =
  | 'TIMEOUT'
  | 'CIRCUIT_OPEN'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/** The few codes the rest of the system and the screens ever see; raw provider text never leaves this file. */
export function normalizeError(err: unknown): NormalizedCode {
  if (err instanceof BrokenCircuitError) return 'CIRCUIT_OPEN';
  if (err instanceof TaskCancelledError) return 'TIMEOUT';
  if (err instanceof ProviderHttpError) {
    if (err.status === 401 || err.status === 403) return 'AUTH_FAILED';
    if (err.status === 429) return 'RATE_LIMITED';
    if (err.status >= 500) return 'PROVIDER_ERROR';
    if (err.status >= 400) return 'BAD_REQUEST';
  }
  const code = (err as { code?: string } | null)?.code;
  if (code && /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE)/.test(code)) return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

export interface RunOptions {
  /** The connection to record success or failure on. */
  connectionId?: string;
  timeoutMs?: number;
  /** Extra tries after a failure; only for calls that are safe to repeat. */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const FAILURES_TO_OPEN = 5;
const HALF_OPEN_AFTER_MS = 30_000;

/**
 * Every call to a provider goes through here (design.md, Error Handling): a timeout, optional
 * retries, a circuit breaker per provider and workspace, error mapping to
 * ExternalServiceException(provider, code), a structured log with no payloads, an Audit_Event on
 * the first failure, and the connection's last-success and last-error times (Requirement 48.6).
 */
@Injectable()
export class AdapterRunner {
  private readonly breakers = new Map<string, CircuitBreakerPolicy>();

  constructor(
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly cls: ClsService<RequestContext>,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run<T>(
    provider: string,
    method: string,
    fn: (signal: AbortSignal) => Promise<T>,
    options: RunOptions = {},
  ): Promise<T> {
    const workspaceId = this.cls.get('workspaceId');
    const started = Date.now();
    try {
      const result = await this.policy(provider, workspaceId, options).execute(({ signal }) =>
        fn(signal),
      );
      this.logger.info(
        { provider, method, durationMs: Date.now() - started, outcome: 'ok' },
        'adapter call succeeded',
      );
      await this.recordSuccess(options.connectionId);
      return result;
    } catch (err) {
      const code = normalizeError(err);
      this.logger.warn(
        { provider, method, durationMs: Date.now() - started, outcome: 'failed', code },
        'adapter call failed',
      );
      await this.recordFailure(provider, method, code, options.connectionId);
      throw new ExternalServiceException(provider, code, code === 'CIRCUIT_OPEN' ? 503 : 502);
    }
  }

  /** Lets tests and the system page see whether a provider's circuit is open. */
  circuitOpen(
    provider: string,
    workspaceId: string | undefined = this.cls.get('workspaceId'),
  ): boolean {
    return this.breakers.get(`${provider}:${workspaceId ?? ''}`)?.state === CircuitState.Open;
  }

  private policy(provider: string, workspaceId: string | undefined, options: RunOptions): IPolicy {
    const key = `${provider}:${workspaceId ?? ''}`;
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = circuitBreaker(handleAll, {
        halfOpenAfter: HALF_OPEN_AFTER_MS,
        breaker: new ConsecutiveBreaker(FAILURES_TO_OPEN),
      });
      this.breakers.set(key, breaker);
    }
    const guard = timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, TimeoutStrategy.Aggressive);
    const policies: IPolicy[] = [];
    if (options.retries && options.retries > 0) {
      policies.push(retry(handleAll, { maxAttempts: options.retries }));
    }
    policies.push(breaker, guard);
    return policies.length === 1
      ? (policies[0] as IPolicy)
      : wrap(...(policies as [IPolicy, IPolicy]));
  }

  private async recordSuccess(connectionId?: string): Promise<void> {
    if (!connectionId) return;
    await this.prisma.scoped.integrationConnection
      .updateMany({
        where: { id: connectionId, status: { not: 'DISCONNECTED' } },
        data: { lastSuccessAt: new Date(), status: 'CONNECTED' },
      })
      .catch((err: unknown) => this.logger.error({ err }, 'could not record adapter success'));
  }

  private async recordFailure(
    provider: string,
    method: string,
    code: NormalizedCode,
    connectionId?: string,
  ): Promise<void> {
    if (!connectionId) return;
    try {
      const before = await this.prisma.scoped.integrationConnection.findFirst({
        where: { id: connectionId },
        select: { status: true },
      });
      if (!before || before.status === 'DISCONNECTED') return;
      await this.prisma.scoped.integrationConnection.updateMany({
        where: { id: connectionId },
        data: { lastErrorAt: new Date(), lastError: code, status: 'ERROR' },
      });
      if (before.status !== 'ERROR') {
        await this.audit.recordAsync({
          action: 'integration.error',
          entityType: 'IntegrationConnection',
          entityId: connectionId,
          metadata: { provider, method, code },
          actor: { type: 'SYSTEM' },
        });
      }
    } catch (err) {
      this.logger.error({ err }, 'could not record adapter failure');
    }
  }
}
