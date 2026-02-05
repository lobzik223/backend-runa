import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Service for checking user entitlements (Premium, Trial, etc.)
 */
@Injectable()
export class EntitlementsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if user has active Premium subscription
   */
  async isPremium(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      return false;
    }

    // Check subscription from store (Apple/Google): ACTIVE и период не истёк
    if (user.subscription?.status === 'ACTIVE' && user.subscription.currentPeriodEnd && new Date() < user.subscription.currentPeriodEnd) {
      return true;
    }

    // Check premiumUntil date
    if (user.premiumUntil && new Date() < user.premiumUntil) {
      return true;
    }

    return false;
  }

  /**
   * Check if user is in trial period
   */
  async isInTrial(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.trialUntil) {
      return false;
    }

    return new Date() < user.trialUntil;
  }

  /**
   * Grant trial period (used during signup)
   */
  async grantTrial(userId: number, days: number) {
    const trialUntil = new Date();
    trialUntil.setDate(trialUntil.getDate() + days);

    await this.prisma.user.update({
      where: { id: userId },
      data: { trialUntil },
    });
  }

  /**
   * Grant premium period (used for referral rewards)
   */
  async grantPremium(userId: number, days: number) {
    const premiumUntil = new Date();
    premiumUntil.setDate(premiumUntil.getDate() + days);

    // Extend existing premium if already active
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user?.premiumUntil && new Date() < user.premiumUntil) {
      // Extend from current end date
      premiumUntil.setTime(user.premiumUntil.getTime() + days * 24 * 60 * 60 * 1000);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { premiumUntil },
    });
  }
}
