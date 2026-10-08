import { Injectable } from '@nestjs/common';
import type { Customer, Lead } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ValidationFailedException } from '../../common/errors/app.exception';

export type LeadConversionHandler = (
  user: AuthUser,
  lead: Lead,
  customer: Customer,
) => Promise<{ id: string; number: string }>;

/** Modules that can be a conversion target (Quotation, Order) register themselves here. */
@Injectable()
export class LeadConversionRegistry {
  private readonly handlers = new Map<string, LeadConversionHandler>();

  register(target: string, handler: LeadConversionHandler): void {
    this.handlers.set(target, handler);
  }

  get(target: string): LeadConversionHandler {
    const handler = this.handlers.get(target);
    if (!handler) throw new ValidationFailedException({ target: ['is not available'] });
    return handler;
  }
}
