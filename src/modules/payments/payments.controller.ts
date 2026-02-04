import { Controller, Post, Get, Body, Headers, BadRequestException, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('config')
  getConfig() {
    return {
      subscriptionSiteUrl: this.paymentsService.getSubscriptionSiteUrl(),
    };
  }

  @Post('demo')
  async demoPayment(
    @Headers('x-runa-site-key') siteKey: string,
    @Body() body: { name?: string; email?: string; emailOrId?: string; planId: string },
  ) {
    this.paymentsService.validateSiteKey(siteKey);
    const emailOrId = (body.emailOrId ?? body.email ?? '').toString().trim();
    if (!emailOrId) {
      throw new BadRequestException('Укажите Email или ID аккаунта');
    }
    if (!body.planId) {
      throw new BadRequestException('Укажите тариф');
    }
    return this.paymentsService.grantDemoSubscription(emailOrId, body.planId);
  }

  @Get('plans')
  getPlans() {
    return this.paymentsService.getPlans();
  }

  /** Верификация чека Apple и активация подписки. Вызывается из приложения после покупки. */
  @Post('apple/verify')
  @UseGuards(JwtAccessGuard)
  async verifyApple(
    @CurrentUser() user: JwtAccessPayload,
    @Body() body: { receipt: string; originalTransactionId?: string },
  ) {
    if (!body.receipt || typeof body.receipt !== 'string') {
      throw new BadRequestException('receipt required');
    }
    return this.paymentsService.verifyAppleAndActivate(
      user.sub,
      body.receipt,
      body.originalTransactionId,
    );
  }

  /** Верификация покупки Google Play и активация подписки. Вызывается из приложения после покупки. */
  @Post('google/verify')
  @UseGuards(JwtAccessGuard)
  async verifyGoogle(
    @CurrentUser() user: JwtAccessPayload,
    @Body() body: { purchaseToken: string; productId: string },
  ) {
    if (!body.purchaseToken || !body.productId) {
      throw new BadRequestException('purchaseToken and productId required');
    }
    return this.paymentsService.verifyGoogleAndActivate(
      user.sub,
      body.purchaseToken,
      body.productId,
    );
  }
}
