import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ReadinessRegistry } from './readiness';

@Injectable()
export class HealthService {
  constructor(private readonly registry: ReadinessRegistry) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: 'ok'; checks: Record<string, 'up'> }> {
    const results = await Promise.all(
      this.registry.all().map(async (c) => {
        try {
          await c.check();
          return { name: c.name, up: true };
        } catch {
          return { name: c.name, up: false };
        }
      }),
    );
    const failed = results.filter((r) => !r.up).map((r) => r.name);
    if (failed.length > 0) {
      throw new AppException('EXTERNAL_SERVICE_FAILED', 503, 'Not ready', { failed });
    }
    return {
      status: 'ok',
      checks: Object.fromEntries(results.map((r) => [r.name, 'up' as const])),
    };
  }
}
