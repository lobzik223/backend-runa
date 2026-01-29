import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import * as crypto from 'crypto';

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

  async createPaymentUrl(emailOrId: string, planId: string) {
    const plan = this.plans[planId];
    if (!plan) {
      throw new BadRequestException('Invalid plan ID');
    }

    // Find user to ensure they exist
    const user = await this.findUser(emailOrId);
    if (!user) {
      throw new BadRequestException('Пользователь не найден. Проверьте Email или ID аккаунта.');
    }

    const merchantLogin = process.env.ROBOKASSA_MERCHANT_LOGIN;
    const pass1 = process.env.ROBOKASSA_PASSWORD_1;
    const isTest = process.env.ROBOKASSA_IS_TEST === 'true' || process.env.ROBOKASSA_IS_TEST === '1';

    if (!merchantLogin || !pass1) {
      this.logger.error('Robokassa credentials not configured');
      throw new BadRequestException('Оплата временно недоступна');
    }

    const invId = 0; // 0 for auto-generation or use a real ID from a 'Payments' table if you have one
    const outSum = plan.price.toString();
    const shpUserId = user.id.toString();
    const shpPlanId = planId;
    
    // Signature: MerchantLogin:OutSum:InvId:Pass1:shpUserId=...:shpPlanId=...
    const signatureSource = `${merchantLogin}:${outSum}:${invId}:${pass1}:shpPlanId=${shpPlanId}:shpUserId=${shpUserId}`;
    const signature = crypto.createHash('md5').update(signatureSource).digest('hex');

    const url = new URL('https://auth.robokassa.ru/Merchant/Index.aspx');
    url.searchParams.append('MerchantLogin', merchantLogin);
    url.searchParams.append('OutSum', outSum);
    url.searchParams.append('InvId', invId.toString());
    url.searchParams.append('Description', plan.description);
    url.searchParams.append('SignatureValue', signature);
    url.searchParams.append('shpUserId', shpUserId);
    url.searchParams.append('shpPlanId', shpPlanId);
    url.searchParams.append('Email', user.email || '');
    if (isTest) {
      url.searchParams.append('IsTest', '1');
    }

    return url.toString();
  }

  async handleRobokassaWebhook(query: any) {
    const { OutSum, InvId, SignatureValue, shpUserId, shpPlanId } = query;
    const pass2 = process.env.ROBOKASSA_PASSWORD_2;

    if (!pass2) {
      this.logger.error('ROBOKASSA_PASSWORD_2 not configured');
      return 'FAIL';
    }

    // Signature: OutSum:InvId:Pass2:shpUserId=...:shpPlanId=...
    const signatureSource = `${OutSum}:${InvId}:${pass2}:shpPlanId=${shpPlanId}:shpUserId=${shpUserId}`;
    const mySignature = crypto.createHash('md5').update(signatureSource).digest('hex').toUpperCase();

    if (SignatureValue?.toUpperCase() !== mySignature) {
      this.logger.warn(`Invalid Robokassa signature. Got: ${SignatureValue}, expected: ${mySignature}`);
      return 'FAIL';
    }

    const userId = parseInt(shpUserId, 10);
    const plan = this.plans[shpPlanId];

    if (!plan || isNaN(userId)) {
      this.logger.error(`Invalid webhook data: plan=${shpPlanId}, userId=${shpUserId}`);
      return 'FAIL';
    }

    this.logger.log(`Granting premium to user ${userId} for plan ${shpPlanId} (${plan.durationMonths} months)`);
    
    const days = plan.durationMonths * 30; // Approximation
    await this.entitlementsService.grantPremium(userId, days);

    // Also update Subscription record for UI consistency
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        status: 'ACTIVE',
        store: 'INTERNAL',
        productId: shpPlanId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
      update: {
        status: 'ACTIVE',
        productId: shpPlanId,
        currentPeriodEnd: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });

    return `OK${InvId}`;
  }

  private async findUser(emailOrId: string) {
    const id = parseInt(emailOrId, 10);
    if (!isNaN(id)) {
      return this.prisma.user.findUnique({ where: { id } });
    }
    return this.prisma.user.findUnique({ where: { email: emailOrId } });
  }

  validateSiteKey(key: string) {
    const expectedKey = process.env.SITE_API_KEY || 'runa-site-secret-key-change-me-in-prod';
    if (key !== expectedKey) {
      throw new UnauthorizedException('Invalid Site API Key');
    }
  }
}
