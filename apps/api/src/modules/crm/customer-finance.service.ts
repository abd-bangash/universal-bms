import { Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CustomerFinanceDto {
  lifetimeValue: string;
  totalPaid: string;
  outstandingBalance: string;
  creditBalance: string;
}

/**
 * Computed, never stored (Requirement 8.6). Orders and payments are added by tasks 31 and 39; until
 * then a customer has none, so every figure is zero.
 */
@Injectable()
export class CustomerFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(customerId: string): Promise<CustomerFinanceDto> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, isWalkIn: false },
    });
    if (!customer) throw new NotFoundAppException();
    return { lifetimeValue: '0', totalPaid: '0', outstandingBalance: '0', creditBalance: '0' };
  }
}
