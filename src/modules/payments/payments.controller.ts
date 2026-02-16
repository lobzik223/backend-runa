import { Controller, Post, Get, Body, Headers, BadRequestException, UseGuards, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('config')
  getConfig() {
    return {
      subscriptionSiteUrl: this.paymentsService.getSubscriptionSiteUrl(),
    };
  }

  /** Создание платежа ЮKassa: возвращает confirmation_url для редиректа. Почта или ID обязательны, пользователь должен существовать. */
  @Post('create')
  async createPayment(
    @Headers('x-runa-site-key') siteKey: string,
    @Body()
    body: {
      planId?: string;
      emailOrId?: string;
      email?: string;
      returnUrl?: string;
      return_url?: string;
      cancelUrl?: string;
      cancel_url?: string;
    },
  ) {
    this.paymentsService.validateSiteKey(siteKey);
    // Поддержка и camelCase, и snake_case для совместимости с разными фронтами
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    const returnUrl = typeof body.returnUrl === 'string' ? body.returnUrl.trim() : (typeof (body as any).return_url === 'string' ? (body as any).return_url.trim() : '');
    const cancelUrl = typeof body.cancelUrl === 'string' ? body.cancelUrl.trim() : (typeof (body as any).cancel_url === 'string' ? (body as any).cancel_url.trim() : '') || returnUrl;
    const emailOrId = (typeof body.emailOrId === 'string' ? body.emailOrId : typeof body.email === 'string' ? body.email : '').trim();

    this.logger.log(`[payments/create] body keys: ${Object.keys(body || {}).join(', ') || '(empty)'}, planId=${planId || '(empty)'}, returnUrl=${returnUrl ? 'ok' : '(empty)'}, emailOrId=${emailOrId ? '***' : '(empty)'}`);

    if (!planId || !returnUrl) {
      throw new BadRequestException('Укажите тариф (planId) и URL возврата после оплаты (returnUrl или return_url)');
    }
    if (!emailOrId) {
      throw new BadRequestException('Укажите Email или ID аккаунта из приложения (emailOrId или email). Без этого к оплате перейти нельзя.');
    }
    return this.paymentsService.createYooKassaPayment(planId, emailOrId, returnUrl, cancelUrl);
  }

  /** Webhook от ЮKassa: только после успешной оплаты выдаём подписку. Вызывается серверами ЮKassa. */
  @Post('yookassa/webhook')
  async yookassaWebhook(@Body() body: { type?: string; event?: string; object?: { id?: string } }) {
    await this.paymentsService.handleYooKassaWebhook(body);
    return {};
  }

  /** После возврата с оплаты: проверить платёж в ЮKassa и выдать подписку при успехе (если webhook ещё не сработал). */
  @Post('confirm-return')
  async confirmReturn(
    @Headers('x-runa-site-key') siteKey: string,
    @Body() body: { paymentId: string },
  ) {
    this.paymentsService.validateSiteKey(siteKey);
    if (!body.paymentId || typeof body.paymentId !== 'string') {
      throw new BadRequestException('Укажите paymentId');
    }
    return this.paymentsService.confirmReturnPayment(body.paymentId);
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

  /** Проверка совпадения Email и ID аккаунта (для формы на сайте). */
  @Post('verify-account')
  async verifyAccount(
    @Headers('x-runa-site-key') siteKey: string,
    @Body() body: { email?: string; accountId?: string },
  ) {
    this.paymentsService.validateSiteKey(siteKey);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    return this.paymentsService.verifyAccountEmailAndId(email, accountId);
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
