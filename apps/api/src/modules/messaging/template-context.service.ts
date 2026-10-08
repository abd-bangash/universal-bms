import { Injectable } from '@nestjs/common';
import type { Conversation } from '@prisma/client';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatDate, formatMoney } from '../documents/format';
import { bankDetailsText, customerFacingAccounts } from '../finance/bank-details';
import { SettingsService } from '../settings/settings.service';

/** The values a conversation's message templates fill their variables with. Missing facts are left out, never invented. */
@Injectable()
export class TemplateContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async values(
    conversation: Conversation,
    orderId?: string,
  ): Promise<Record<string, string | undefined>> {
    const [customer, lead, business, locale, accounts] = await Promise.all([
      conversation.customerId
        ? this.prisma.scoped.customer.findFirst({ where: { id: conversation.customerId } })
        : null,
      conversation.leadId
        ? this.prisma.scoped.lead.findFirst({ where: { id: conversation.leadId } })
        : null,
      this.settings.get<{ legalName?: string } | undefined>('business'),
      this.settings.get<{
        currency: string;
        currencyDecimals: number;
        language: string;
        dateFormat: string;
        timezone: string;
      }>('locale'),
      customerFacingAccounts(this.prisma),
    ]);
    const values: Record<string, string | undefined> = {
      customer_name: customer?.fullName ?? lead?.fullName ?? conversation.contactName ?? undefined,
      business_name: business?.legalName,
      bank_details: accounts.length > 0 ? bankDetailsText(accounts) : undefined,
      follow_up_date: lead?.nextActionDate
        ? formatDate(lead.nextActionDate.toISOString(), locale.dateFormat, locale.timezone)
        : undefined,
    };
    if (orderId) {
      const order = await this.prisma.scoped.order.findFirst({ where: { id: orderId } });
      if (!order) throw new ValidationFailedException({ orderId: ['does not exist'] });
      const currency = { code: locale.currency, decimals: locale.currencyDecimals };
      values.order_number = order.orderNumber;
      values.order_total = formatMoney(order.totalAmount.toString(), currency, locale.language);
      values.balance_due = formatMoney(order.balanceDue.toString(), currency, locale.language);
    }
    return values;
  }
}
