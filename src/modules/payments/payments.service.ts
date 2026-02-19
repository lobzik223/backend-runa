import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';

export interface PaymentPlan {
  id: string;
  durationMonths: number;
  price: number;
  description: string;
}

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly plans: Record<string, PaymentPlan> = {
    '1month': { id: '1month', durationMonths: 1, price: 400, description: 'Подписка Runa Premium на 1 месяц' },
    '6months': { id: '6months', durationMonths: 6, price: 1800, description: 'Подписка Runa Premium на 6 месяцев' },
    '1year': { id: '1year', durationMonths: 12, price: 2500, description: 'Подписка Runa Premium на 1 год' },
  };

  constructor(
    private prisma: PrismaService,
    private entitlementsService: EntitlementsService,
  ) {}

  private getYooKassaAuth(): { shopId: string; secretKey: string } | null {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;
    if (!shopId || !secretKey) return null;
    return { shopId: String(shopId), secretKey };
  }

  getPlans() {
    return Object.values(this.plans);
  }

  /**
   * Валидация промокода для сайта: активен ли, цены по тарифам со скидкой.
   * Не проверяет одноразовость (это при создании платежа).
   */
  async validatePromo(code: string): Promise<{
    valid: boolean;
    message?: string;
    discountType?: string;
    discountValue?: number;
    prices?: { '1month': number; '6months': number; '1year': number };
  }> {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c) return { valid: false, message: 'Введите промокод' };
    const promo = await this.prisma.promoCode.findUnique({ where: { code: c } });
    if (!promo) return { valid: false, message: 'Промокод не найден' };
    const now = new Date();
    if (now < promo.validFrom) return { valid: false, message: 'Промокод ещё не действует' };
    if (now > promo.validUntil) return { valid: false, message: 'Промокод истёк' };
    const prices: { '1month': number; '6months': number; '1year': number } = { '1month': 0, '6months': 0, '1year': 0 };
    for (const [planId, plan] of Object.entries(this.plans)) {
      const discount =
        promo.discountType === 'PERCENT' ? (plan.price * promo.discountValue) / 100 : promo.discountValue;
      const value = Math.round((plan.price - discount) * 100) / 100;
      prices[planId as keyof typeof prices] = Math.max(1, value); // минимум 1 ₽ для ЮKassa
    }
    return {
      valid: true,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      prices,
    };
  }

  getSubscriptionSiteUrl() {
    return process.env.SUBSCRIPTION_SITE_URL || 'https://runafinance.online/premium';
  }

  /**
   * Создать платёж в ЮKassa и сохранить запись в БД (PENDING).
   * promoCodeId или promoCode (строка кода) — опционально. Скидка в % или ₽, один раз на одного пользователя.
   */
  async createYooKassaPayment(
    planId: string,
    emailOrId: string,
    returnUrl: string,
    cancelUrl: string,
    promoCodeId?: string,
    promoCode?: string,
  ): Promise<{ confirmationUrl: string; paymentId: string }> {
    const auth = this.getYooKassaAuth();
    if (!auth) {
      this.logger.warn('[YooKassa] YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY not set');
      throw new ServiceUnavailableException('Оплата через ЮKassa не настроена');
    }

    const plan = this.plans[planId];
    if (!plan) {
      this.logger.warn(`[YooKassa] 400: неверный тариф planId="${planId}". Допустимые: ${Object.keys(this.plans).join(', ')}`);
      throw new BadRequestException(
        `Неверный тариф. Укажите один из: ${Object.keys(this.plans).join(', ')}`,
      );
    }

    const trimmedEmailOrId = String(emailOrId ?? '').trim();
    if (!trimmedEmailOrId) {
      this.logger.warn('[YooKassa] 400: не указана почта или ID (emailOrId/email пустой)');
      throw new BadRequestException('Укажите Email или ID аккаунта из приложения. Без этого к оплате перейти нельзя.');
    }

    this.logger.log(`[YooKassa] Запрос на создание платежа: planId=${planId}, emailOrId=${trimmedEmailOrId}`);

    // Жёсткая проверка: пользователь должен существовать в БД. Если нет — к оплате не переводим.
    const user = await this.findUser(trimmedEmailOrId);
    if (!user) {
      this.logger.warn(`[YooKassa] 400: пользователь не найден в БД. emailOrId="${trimmedEmailOrId}" — запрос к ЮKassa не отправляется.`);
      throw new BadRequestException(
        'Аккаунт не найден. Проверьте Email или ID аккаунта из профиля в приложении. К оплате не переводим.',
      );
    }

    const userEmail = user.email ?? '(без почты)';
    this.logger.log(`[YooKassa] Пользователь найден: userId=${user.id}, email=${userEmail}. Создаём платёж planId=${planId}`);

    let amountRub = plan.price;
    let linkedPromoId: string | null = null;
    const promoIdOrCode = promoCodeId?.trim() || promoCode?.trim();
    if (promoIdOrCode) {
      const promo = promoCodeId
        ? await this.prisma.promoCode.findUnique({ where: { id: promoCodeId.trim() } })
        : await this.prisma.promoCode.findUnique({ where: { code: promoCode!.trim().toUpperCase() } });
      if (promo && new Date() >= promo.validFrom && new Date() <= promo.validUntil) {
        const alreadyUsed = await this.prisma.yooKassaPayment.count({
          where: { promoCodeId: promo.id, userId: user.id, status: 'SUCCEEDED' },
        });
        if (alreadyUsed > 0) {
          this.logger.warn(`[YooKassa] Пользователь ${user.id} уже использовал промокод ${promo.code}`);
          throw new BadRequestException(
            'Данный пользователь уже использовал этот промокод. Оплата возможна без промокода.',
          );
        }
        const discount =
          promo.discountType === 'PERCENT'
            ? (plan.price * promo.discountValue) / 100
            : promo.discountValue;
        const withDiscount = Math.round((plan.price - discount) * 100) / 100;
        amountRub = Math.max(1, withDiscount); // минимум 1 ₽ в платёжном запросе и в чеке
        linkedPromoId = promo.id;
        this.logger.log(`[YooKassa] Промокод ${promo.code}: скидка ${promo.discountType === 'PERCENT' ? promo.discountValue + '%' : promo.discountValue + ' ₽'}, итого ${amountRub} ₽`);
      }
    }

    const idempotenceKey = `runa-${planId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const basicAuth = Buffer.from(`${auth.shopId}:${auth.secretKey}`).toString('base64');

    const amountValue = Math.max(1, amountRub);
    const amountStr = amountValue.toFixed(2);
    const receiptCustomer = trimmedEmailOrId.includes('@') ? { customer: { email: trimmedEmailOrId } } : {};
    const body = {
      amount: { value: amountStr, currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
        enforce: false,
      },
      description: plan.description.slice(0, 128),
      metadata: { planId, emailOrId: trimmedEmailOrId },
      receipt: {
        ...receiptCustomer,
        items: [
          {
            description: plan.description.slice(0, 128),
            quantity: '1',
            amount: { value: amountStr, currency: 'RUB' },
            vat_code: 1,
            payment_subject: 'service' as const,
            payment_mode: 'full_payment' as const,
          },
        ],
      },
    };

    const res = await fetch(`${YOOKASSA_API}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      id?: string;
      status?: string;
      confirmation?: { confirmation_url?: string };
      code?: string;
      description?: string;
    };

    if (!res.ok) {
      this.logger.warn(`[YooKassa] Ошибка создания платежа: code=${data.code}, description=${data.description}, planId=${planId}, email=${userEmail}`);
      const desc = (data.description || '').toLowerCase();
      if (desc.includes('shopid') || desc.includes('secret key') || desc.includes('reissue')) {
        throw new BadRequestException('Оплата временно недоступна. Обратитесь в поддержку.');
      }
      throw new BadRequestException(data.description || 'Не удалось создать платёж');
    }

    const yookassaPaymentId = data.id;
    const confirmationUrl = data.confirmation?.confirmation_url;

    if (!yookassaPaymentId || !confirmationUrl) {
      this.logger.warn('[YooKassa] Missing id or confirmation_url in response', data);
      throw new ServiceUnavailableException('Некорректный ответ от платёжной системы');
    }

    await this.prisma.yooKassaPayment.create({
      data: {
        yookassaPaymentId,
        planId,
        emailOrId: trimmedEmailOrId,
        status: 'PENDING',
        amountPaid: amountRub,
        ...(linkedPromoId ? { promoCodeId: linkedPromoId } : {}),
      },
    });

    this.logger.log(`[YooKassa] Платёж создан: paymentId=${yookassaPaymentId}, planId=${planId}, userId=${user.id}, email=${userEmail}`);

    return { confirmationUrl, paymentId: yookassaPaymentId };
  }

  /**
   * Проверить платёж в ЮKassa и выдать подписку ТОЛЬКО при status === 'succeeded'.
   * Строго: без оплаты подписка не выдаётся. Отмена, ошибка, pending, refund — подписку не даём.
   * Используется webhook'ом и страницей успеха (confirm-return). Идемпотентно.
   */
  async processSucceededYooKassaPayment(yookassaPaymentId: string): Promise<{ granted: boolean }> {
    const auth = this.getYooKassaAuth();
    if (!auth) {
      return { granted: false };
    }

    const existing = await this.prisma.yooKassaPayment.findUnique({
      where: { yookassaPaymentId },
    });

    if (!existing) {
      this.logger.warn(`[YooKassa] Unknown payment ${yookassaPaymentId}`);
      return { granted: false };
    }

    if (existing.status === 'SUCCEEDED' && existing.grantedAt) {
      this.logger.log(`[YooKassa] Payment ${yookassaPaymentId} already granted`);
      return { granted: true };
    }

    const basicAuth = Buffer.from(`${auth.shopId}:${auth.secretKey}`).toString('base64');
    const getRes = await fetch(`${YOOKASSA_API}/payments/${yookassaPaymentId}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${basicAuth}` },
    });

    if (!getRes.ok) {
      this.logger.warn(`[YooKassa] Failed to get payment ${yookassaPaymentId}`, getRes.status);
      return { granted: false };
    }

    const payment = (await getRes.json()) as {
      id: string;
      status: string;
      metadata?: { planId?: string; emailOrId?: string };
    };

    // Строго: подписку выдаём только при успешной оплате. canceled, pending, failed, refund и т.д. — не выдаём.
    const statusLower = String(payment.status || '').toLowerCase();
    if (statusLower !== 'succeeded') {
      this.logger.log(`[YooKassa] Payment ${yookassaPaymentId} status="${payment.status}" — subscription not granted`);
      await this.prisma.yooKassaPayment.update({
        where: { yookassaPaymentId },
        data: { status: (payment.status || 'UNKNOWN').toUpperCase().replace(/-/g, '_') },
      });
      return { granted: false };
    }

    const planId = payment.metadata?.planId ?? existing.planId;
    const emailOrId = payment.metadata?.emailOrId ?? existing.emailOrId;
    const plan = this.plans[planId];

    if (!plan) {
      this.logger.warn(`[YooKassa] Unknown planId ${planId} for payment ${yookassaPaymentId}`);
      await this.prisma.yooKassaPayment.update({
        where: { yookassaPaymentId },
        data: { status: 'SUCCEEDED' },
      });
      return { granted: false };
    }

    const user = await this.findUser(emailOrId);
    if (!user) {
      this.logger.warn(`[YooKassa] Пользователь не найден. emailOrId=${emailOrId}, paymentId=${yookassaPaymentId} — подписка не выдана.`);
      await this.prisma.yooKassaPayment.update({
        where: { yookassaPaymentId },
        data: { status: 'SUCCEEDED' },
      });
      return { granted: false };
    }

    const days = plan.durationMonths * 30;
    await this.entitlementsService.grantPremium(user.id, days);

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        status: 'ACTIVE',
        store: 'INTERNAL',
        productId: planId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
      update: {
        status: 'ACTIVE',
        productId: planId,
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.yooKassaPayment.update({
      where: { yookassaPaymentId },
      data: { status: 'SUCCEEDED', userId: user.id, grantedAt: new Date() },
    });

    const amountStr = existing.amountPaid != null ? ` ${Number(existing.amountPaid)} ₽` : '';
    await this.prisma.subscriptionHistory.create({
      data: {
        userId: user.id,
        action: 'payment',
        details: `Оплата ${planId}${amountStr}`,
      },
    });
    await this.keepLastSubscriptionHistory(user.id, 5);

    this.logger.log(`[YooKassa] Подписка выдана: userId=${user.id}, email=${user.email ?? '(нет почты)'}, paymentId=${yookassaPaymentId}, planId=${planId}, days=${days}`);
    return { granted: true };
  }

  private async keepLastSubscriptionHistory(userId: number, keep: number) {
    const ids = await this.prisma.subscriptionHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: keep,
      select: { id: true },
    });
    const keepIds = ids.map((r) => r.id);
    if (keepIds.length === 0) return;
    await this.prisma.subscriptionHistory.deleteMany({
      where: { userId, id: { notIn: keepIds } },
    });
  }

  /**
   * Обработка webhook от ЮKassa. Обрабатываем только event === 'payment.succeeded'.
   * payment.canceled, payment.waiting_for_capture и любые другие события — игнорируем, подписку не выдаём.
   */
  async handleYooKassaWebhook(body: {
    type?: string;
    event?: string;
    object?: { id?: string };
  }): Promise<void> {
    if (body.type !== 'notification' || body.event !== 'payment.succeeded' || !body.object?.id) {
      return;
    }
    await this.processSucceededYooKassaPayment(body.object.id);
  }

  /**
   * Подтверждение после возврата с платёжной страницы: проверяем платёж в ЮKassa и выдаём подписку при успехе.
   * Вызывается со страницы /premium/success (если webhook ещё не сработал).
   */
  async confirmReturnPayment(paymentId: string): Promise<{ granted: boolean }> {
    const trimmed = String(paymentId).trim();
    if (!trimmed) {
      throw new BadRequestException('Укажите идентификатор платежа');
    }
    return this.processSucceededYooKassaPayment(trimmed);
  }

  /**
   * Демо-оплата отключена при включённой ЮKassa. Выдача подписки только после реальной оплаты.
   */
  async grantDemoSubscription(emailOrId: string, planId: string) {
    if (this.getYooKassaAuth()) {
      throw new BadRequestException(
        'Демо-оплата отключена. Используйте оформление подписки с оплатой через ЮKassa.',
      );
    }
    const plan = this.plans[planId];
    if (!plan) {
      throw new BadRequestException('Неверный тариф');
    }

    const user = await this.findUser(emailOrId);
    if (!user) {
      throw new BadRequestException('Пользователь не найден. Проверьте Email или ID аккаунта из приложения.');
    }

    const days = plan.durationMonths * 30;
    this.logger.log(`[Demo] Granting premium to user ${user.id} (${user.email}) for plan ${planId} (${days} days)`);

    await this.entitlementsService.grantPremium(user.id, days);

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        status: 'ACTIVE',
        store: 'INTERNAL',
        productId: planId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
      update: {
        status: 'ACTIVE',
        productId: planId,
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });

    return { success: true, userId: user.id, planId, days };
  }

  private async findUser(emailOrId: string) {
    const trimmed = String(emailOrId).trim();
    const id = parseInt(trimmed, 10);
    if (!Number.isNaN(id) && id > 0) {
      return this.prisma.user.findUnique({ where: { id } });
    }
    if (trimmed) {
      return this.prisma.user.findUnique({ where: { email: trimmed } });
    }
    return null;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Проверка совпадения почты и ID аккаунта. Для формы оплаты на сайте.
   */
  async verifyAccountEmailAndId(email: string, accountId: string): Promise<{ valid: boolean; message?: string }> {
    const trimmedEmail = this.normalizeEmail(email);
    const trimmedId = String(accountId).trim();
    const userId = parseInt(trimmedId, 10);

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return { valid: false, message: 'Введите корректный адрес электронной почты.' };
    }
    if (!trimmedId || Number.isNaN(userId) || userId <= 0) {
      return { valid: false, message: 'Введите ID аккаунта из профиля в приложении (число).' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return { valid: false, message: 'Аккаунт с таким ID не найден. Проверьте ID в профиле приложения.' };
    }

    const userEmail = user.email ? this.normalizeEmail(user.email) : '';
    if (userEmail !== trimmedEmail) {
      return { valid: false, message: 'Почта не совпадает с ID вашего аккаунта. Укажите данные из профиля в приложении.' };
    }

    return { valid: true };
  }

  validateSiteKey(key: string) {
    const expectedKey = process.env.SITE_API_KEY || 'runa-site-secret-key-change-me-in-prod';
    if (key !== expectedKey) {
      throw new UnauthorizedException('Invalid Site API Key');
    }
  }

  /**
   * Верификация чека Apple и активация подписки для пользователя.
   * Требует APPLE_SHARED_SECRET в .env (App Store Connect → App → App-Specific Shared Secret).
   */
  async verifyAppleAndActivate(userId: number, receipt: string, originalTransactionId?: string): Promise<{ success: boolean }> {
    const secret = process.env.APPLE_SHARED_SECRET;
    if (!secret) {
      this.logger.warn('[Apple IAP] APPLE_SHARED_SECRET not set');
      throw new ServiceUnavailableException('Apple IAP not configured');
    }
    let body: { 'receipt-data': string; password: string } = {
      'receipt-data': receipt,
      password: secret,
    };
    const urls = [
      'https://buy.itunes.apple.com/verifyReceipt',
      'https://sandbox.itunes.apple.com/verifyReceipt',
    ];
    let lastStatus: number | undefined;
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        status: number;
        receipt?: { in_app?: Array<{ expires_date_ms?: string; original_transaction_id?: string; product_id?: string }> };
        latest_receipt_info?: Array<{
          expires_date_ms?: string;
          original_transaction_id?: string;
          product_id?: string;
        }>;
      };
      lastStatus = data.status;
      if (data.status === 0) {
        const list = data.latest_receipt_info ?? data.receipt?.in_app ?? [];
        let expiresMs = 0;
        let productId: string | null = null;
        let origTxId: string | null = null;
        for (const item of list) {
          const ms = item.expires_date_ms ? parseInt(item.expires_date_ms, 10) : 0;
          if (ms > expiresMs) {
            expiresMs = ms;
            productId = item.product_id ?? null;
            origTxId = item.original_transaction_id ?? null;
          }
        }
        if (expiresMs > Date.now()) {
          const currentPeriodEnd = new Date(expiresMs);
          await this.prisma.subscription.upsert({
            where: { userId },
            create: {
              userId,
              status: 'ACTIVE',
              store: 'APPLE',
              productId: productId ?? undefined,
              appleOriginalTransactionId: origTxId ?? originalTransactionId ?? undefined,
              currentPeriodStart: new Date(),
              currentPeriodEnd,
            },
            update: {
              status: 'ACTIVE',
              productId: productId ?? undefined,
              appleOriginalTransactionId: origTxId ?? originalTransactionId ?? undefined,
              currentPeriodEnd,
            },
          });
          this.logger.log(`[Apple IAP] Activated subscription for user ${userId}`);
          return { success: true };
        }
      }
      if (data.status !== 21007) break;
    }
    this.logger.warn(`[Apple IAP] Verify failed status=${lastStatus}`);
    throw new BadRequestException('Invalid or expired receipt');
  }

  /**
   * Верификация покупки Google Play и активация подписки.
   * Требует GOOGLE_APPLICATION_CREDENTIALS (путь к JSON ключу) и ANDROID_PACKAGE_NAME в .env.
   */
  async verifyGoogleAndActivate(
    userId: number,
    purchaseToken: string,
    productId: string,
  ): Promise<{ success: boolean }> {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const packageName = process.env.ANDROID_PACKAGE_NAME;
    if (!keyPath || !packageName) {
      this.logger.warn('[Google IAP] GOOGLE_APPLICATION_CREDENTIALS or ANDROID_PACKAGE_NAME not set');
      throw new ServiceUnavailableException('Google IAP not configured');
    }
    // Ленивая загрузка googleapis — библиотека тяжёлая, не грузим при старте приложения (экономия RAM на сервере)
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const androidPublisher = google.androidpublisher({ version: 'v3', auth });
    const res = await androidPublisher.purchases.subscriptions.get({
      packageName,
      subscriptionId: productId,
      token: purchaseToken,
    });
    const data = res.data;
    const expiryMs = data.expiryTimeMillis ? parseInt(String(data.expiryTimeMillis), 10) : 0;
    if (expiryMs <= Date.now()) {
      throw new BadRequestException('Subscription expired');
    }
    const currentPeriodEnd = new Date(expiryMs);
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        status: 'ACTIVE',
        store: 'GOOGLE',
        productId,
        googlePurchaseToken: purchaseToken,
        currentPeriodStart: new Date(),
        currentPeriodEnd,
      },
      update: {
        status: 'ACTIVE',
        productId,
        googlePurchaseToken: purchaseToken,
        currentPeriodEnd,
      },
    });
    this.logger.log(`[Google IAP] Activated subscription for user ${userId}`);
    return { success: true };
  }
}
