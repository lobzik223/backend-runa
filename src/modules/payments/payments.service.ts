import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
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
}
