import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PaymentsService } from '../payments/payments.service';

@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Создать ссылку на оплату ЮKassa (для панели: с опциональным промокодом).
   * Возвращает confirmationUrl — открыть в новой вкладке или скопировать пользователю.
   */
  @Post('payments/create-link')
  async createPaymentLink(
    @Body()
    body: {
      planId?: string;
      emailOrId?: string;
      promoCodeId?: string;
      returnUrl?: string;
      cancelUrl?: string;
    },
  ) {
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    const emailOrId = (body.emailOrId ?? body.email ?? '').toString().trim();
    const promoCodeId = typeof body.promoCodeId === 'string' ? body.promoCodeId.trim() || undefined : undefined;
    const baseUrl = this.paymentsService.getSubscriptionSiteUrl().replace(/\/?$/, '');
    const returnUrl = typeof body.returnUrl === 'string' && body.returnUrl.trim()
      ? body.returnUrl.trim()
      : `${baseUrl}/success`;
    const cancelUrl = typeof body.cancelUrl === 'string' && body.cancelUrl.trim()
      ? body.cancelUrl.trim()
      : `${baseUrl}/premium`;

    if (!planId || !emailOrId) {
      throw new BadRequestException('Укажите planId и emailOrId (email или ID пользователя)');
    }
    return this.paymentsService.createYooKassaPayment(
      planId,
      emailOrId,
      returnUrl,
      cancelUrl,
      promoCodeId,
    );
  }
}
