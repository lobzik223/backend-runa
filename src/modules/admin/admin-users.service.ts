import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
            currentPeriodEnd: true,
            productId: true,
            store: true,
          },
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
            currentPeriodEnd: user.subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
    };
  }

  async blockUser(id: number, reason: string, until: Date) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.update({
      where: { id },
      data: { blockedUntil: until, blockReason: reason || null },
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
    return { success: true };
  }

  async list(search: string = '', page: number = 1, limit: number = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const take = Math.min(100, Math.max(1, limit));

    const where =
      search && search.trim()
        ? {
            OR: [
              { email: { contains: search.trim(), mode: 'insensitive' as const } },
              { name: { contains: search.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {};

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
}
