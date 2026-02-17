import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
const MIN_DAYS = 1;
const MAX_DAYS = 360;
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phoneE164: true,
        createdAt: true,
        premiumUntil: true,
        trialUntil: true,
        blockedUntil: true,
        blockReason: true,
        deletionRequestedAt: true,
        scheduledDeleteAt: true,
        subscription: {
          select: {
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            productId: true,
            store: true,
          },
        },
        subscriptionHistory: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { action: true, details: true, createdAt: true },
        },
        blockHistory: {
          orderBy: { blockedAt: 'desc' },
          take: 10,
          select: { blockedAt: true, blockedUntil: true, reason: true, unblockedAt: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return {
      ...user,
      premiumUntil: user.premiumUntil?.toISOString() ?? null,
      trialUntil: user.trialUntil?.toISOString() ?? null,
      blockedUntil: user.blockedUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      scheduledDeleteAt: user.scheduledDeleteAt?.toISOString() ?? null,
      subscription: user.subscription
        ? {
            ...user.subscription,
            currentPeriodStart: user.subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: user.subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      subscriptionHistory: user.subscriptionHistory.map((h) => ({
        ...h,
        createdAt: h.createdAt.toISOString(),
      })),
      blockHistory: user.blockHistory.map((b) => ({
        blockedAt: b.blockedAt.toISOString(),
        blockedUntil: b.blockedUntil?.toISOString() ?? null,
        reason: b.reason ?? null,
        unblockedAt: b.unblockedAt?.toISOString() ?? null,
      })),
    };
  }

  async blockUser(id: number, reason: string, until: Date) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.update({
      where: { id },
      data: { blockedUntil: until, blockReason: reason || null },
    });
    await this.prisma.blockHistory.create({
      data: { userId: id, blockedUntil: until, reason: reason || null },
    });
    return { success: true };
  }

  async unblockUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.update({
      where: { id },
      data: { blockedUntil: null, blockReason: null },
    });
    const last = await this.prisma.blockHistory.findFirst({
      where: { userId: id, unblockedAt: null },
      orderBy: { blockedAt: 'desc' },
    });
    if (last) {
      await this.prisma.blockHistory.update({
        where: { id: last.id },
        data: { unblockedAt: new Date() },
      });
    }
    return { success: true };
  }

  async list(
    opts: { search?: string; userId?: number } = {},
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = Math.max(0, (page - 1) * limit);
    const take = Math.min(100, Math.max(1, limit));

    const conditions: object[] = [];
    if (opts.userId != null && opts.userId > 0) {
      conditions.push({ id: opts.userId });
    }
    if (opts.search && opts.search.trim()) {
      conditions.push({
        OR: [
          { email: { contains: opts.search.trim(), mode: 'insensitive' as const } },
          { name: { contains: opts.search.trim(), mode: 'insensitive' as const } },
        ],
      });
    }
    const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : { AND: conditions }) : {};

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phoneE164: true,
          createdAt: true,
          premiumUntil: true,
          trialUntil: true,
          blockedUntil: true,
          blockReason: true,
          subscription: {
            select: {
              status: true,
              currentPeriodEnd: true,
              productId: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({
        ...u,
        subscription: u.subscription
          ? {
              status: u.subscription.status,
              currentPeriodEnd: u.subscription.currentPeriodEnd?.toISOString() ?? null,
              productId: u.subscription.productId,
            }
          : null,
        premiumUntil: u.premiumUntil?.toISOString() ?? null,
        trialUntil: u.trialUntil?.toISOString() ?? null,
        blockedUntil: u.blockedUntil?.toISOString() ?? null,
        blockReason: u.blockReason ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      limit: take,
    };
  }

  async grantSubscription(userId: number, days: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const numDays = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(days) || 30));
    const now = new Date();
    let premiumUntil = new Date(now.getTime() + numDays * 24 * 60 * 60 * 1000);
    if (user.premiumUntil && user.premiumUntil > now) {
      premiumUntil = new Date(user.premiumUntil.getTime() + numDays * 24 * 60 * 60 * 1000);
    }
    await this.prisma.user.update({ where: { id: userId }, data: { premiumUntil } });
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        status: 'ACTIVE',
        store: 'INTERNAL',
        currentPeriodStart: now,
        currentPeriodEnd: premiumUntil,
      },
      update: { status: 'ACTIVE', currentPeriodEnd: premiumUntil },
    });
    await this.addSubscriptionHistory(userId, 'granted', `+${numDays} дн.`);
    return { success: true, premiumUntil: premiumUntil.toISOString() };
  }

  async reduceSubscription(userId: number, days: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const numDays = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(days) || 1));
    const now = new Date();
    const endDate = user.premiumUntil ?? user.subscription?.currentPeriodEnd ?? null;
    if (!endDate || endDate <= now) {
      throw new BadRequestException('Нет активной подписки для уменьшения');
    }
    const ms = numDays * 24 * 60 * 60 * 1000;
    const premiumUntil = new Date(endDate.getTime() - ms);
    if (premiumUntil <= now) {
      await this.prisma.user.update({ where: { id: userId }, data: { premiumUntil: null } });
      if (user.subscription) {
        await this.prisma.subscription.update({
          where: { userId },
          data: { status: 'NONE', currentPeriodEnd: null },
        });
      }
      await this.addSubscriptionHistory(userId, 'reduced', `−${numDays} дн. (снято)`);
      return { success: true, premiumUntil: null };
    }
    await this.prisma.user.update({ where: { id: userId }, data: { premiumUntil } });
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        status: 'ACTIVE',
        store: 'INTERNAL',
        currentPeriodStart: now,
        currentPeriodEnd: premiumUntil,
      },
      update: { currentPeriodEnd: premiumUntil },
    });
    await this.addSubscriptionHistory(userId, 'reduced', `−${numDays} дн.`);
    return { success: true, premiumUntil: premiumUntil.toISOString() };
  }

  async revokeSubscription(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.update({ where: { id: userId }, data: { premiumUntil: null } });
    if (user.subscription) {
      await this.prisma.subscription.update({
        where: { userId },
        data: { status: 'NONE', currentPeriodEnd: null },
      });
    }
    await this.addSubscriptionHistory(userId, 'revoked', 'Подписка снята');
    return { success: true };
  }

  private async addSubscriptionHistory(userId: number, action: string, details: string | null) {
    await this.prisma.subscriptionHistory.create({
      data: { userId, action, details },
    });
    await this.keepLastSubscriptionHistory(userId, 5);
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
}
