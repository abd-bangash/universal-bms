import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { WebhookThrottle } from '../../common/throttle/throttle';
import { WebhookIngestService } from './webhook-workspace/webhook-ingest.service';

/** Where providers deliver events (design.md "Channels and Integrations"). Public: the signature is the credential. */
@Controller('webhooks')
@Public()
@WebhookThrottle()
export class WebhooksController {
  constructor(private readonly ingest: WebhookIngestService) {}

  @Get(':provider')
  @SkipEnvelope()
  challenge(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ): string {
    res.type('text/plain');
    return this.ingest.challenge(provider, query);
  }

  @Post(':provider')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    return this.ingest.receive(provider, req.rawBody, headers);
  }
}
