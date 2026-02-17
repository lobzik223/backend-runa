import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

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
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      limit: take,
    };
  }
}
