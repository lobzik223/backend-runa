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

  getPlans() {
    return Object.values(this.plans);
  }

  getSubscriptionSiteUrl() {
    return process.env.SUBSCRIPTION_SITE_URL || 'https://runafinance.online/premium';
  }

  /**
   * Демо-оплата: выдать подписку без реальной оплаты (для теста с сайта).
   * Ищет пользователя по email или ID, начисляет период по тарифу.
   */
  async grantDemoSubscription(emailOrId: string, planId: string) {
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
