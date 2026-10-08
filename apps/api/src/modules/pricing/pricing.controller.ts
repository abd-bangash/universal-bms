import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app.exception';
import { PricingPreviewDto } from './pricing.dto';
import { PricingService } from './pricing.service';

const PREVIEW_PERMISSIONS = ['quotation:create', 'order:create', 'pos:sell'];

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Live totals for the line editor: nothing is saved. */
  @Post('preview')
  @Authenticated()
  @HttpCode(200)
  async preview(@CurrentUser() user: AuthUser, @Body() dto: PricingPreviewDto) {
    if (!PREVIEW_PERMISSIONS.some((p) => user.permissions.includes(p))) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    const priced = await this.pricing.price(user, dto);
    const totals = Object.fromEntries(
      Object.entries(priced.calc).filter(([key]) => key !== 'lines'),
    );
    return {
      lines: priced.lines.map((l) => ({
        lineNo: l.lineNo,
        kind: l.kind,
        variantId: l.variantId,
        name: l.name,
        sku: l.sku,
        quantity: l.quantity,
        listPrice: l.listPrice,
        unitPrice: l.unitPrice,
        taxClassId: l.taxClassId,
        taxRate: l.taxRate,
        ...l.calc,
      })),
      ...totals,
      overrides: priced.overrides,
      settings: priced.settings,
    };
  }
}
