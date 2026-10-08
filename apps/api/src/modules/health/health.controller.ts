import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
@Public()
@SkipThrottle({ default: true, auth: true, webhook: true })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Get('ready')
  ready(): Promise<{ status: 'ok'; checks: Record<string, 'up'> }> {
    return this.health.ready();
  }
}
