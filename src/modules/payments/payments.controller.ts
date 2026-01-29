import { Controller, Post, Get, Body, Query, Headers, HttpCode } from '@nestjs/common';
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

  @Post('create')
  async createPayment(
    @Headers('x-runa-site-key') siteKey: string,
    @Body() body: { emailOrId: string; planId: string },
  ) {
    this.paymentsService.validateSiteKey(siteKey);
    const url = await this.paymentsService.createPaymentUrl(body.emailOrId, body.planId);
    return { url };
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Query() query: any) {
    return this.paymentsService.handleRobokassaWebhook(query);
  }

  @Get('plans')
  getPlans() {
    return this.paymentsService.getPlans();
  }
}
