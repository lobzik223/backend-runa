import { Controller, Post, Get, Body, Headers, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

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
}
