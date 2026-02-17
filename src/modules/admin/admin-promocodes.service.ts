import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminPromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const list = await this.prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { payments: true } },
      },
    });
    return list.map((p) => this.toResponse({ ...p, _count: p._count }));
  }

  async create(dto: { code: string; name: string; discountType: string; discountValue: number; validUntil: string }) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    const name = String(dto.name ?? '').trim();
    const discountType = String(dto.discountType ?? 'RUB').toUpperCase() === 'PERCENT' ? 'PERCENT' : 'RUB';
    let discountValue: number;
    if (discountType === 'PERCENT') {
      discountValue = Math.max(1, Math.min(100, Math.floor(Number(dto.discountValue) || 0)));
    } else {
      discountValue = Math.max(0, Math.floor(Number(dto.discountValue) || 0));
    }
    const validUntil = new Date(dto.validUntil);

    if (!code || code.length < 2) {
      throw new BadRequestException('Укажите код промокода (не менее 2 символов)');
    }
    if (!name) {
      throw new BadRequestException('Укажите название источника');
    }
    if (validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('Дата окончания должна быть в будущем');
    }

    const existing = await this.prisma.promoCode.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException(`Промокод "${code}" уже существует`);
    }

    const created = await this.prisma.promoCode.create({
      data: {
        code,
        name,
        discountType,
        discountValue,
        validUntil,
      },
    });
    return this.toResponse(created);
  }

  async getStats(promoId: string) {
    const promo = await this.prisma.promoCode.findUnique({
      where: { id: promoId },
      include: {
        payments: {
          where: { status: 'SUCCEEDED' },
          select: { planId: true, userId: true, amountPaid: true },
        },
      },
    });
    if (!promo) throw new BadRequestException('Промокод не найден');
    const succeeded = promo.payments;
    const byPlan: Record<string, number> = { '1month': 0, '6months': 0, '1year': 0 };
    let totalAmount = 0;
    for (const p of succeeded) {
      byPlan[p.planId] = (byPlan[p.planId] ?? 0) + 1;
      totalAmount += Number(p.amountPaid ?? 0);
    }
    const usersCount = new Set(succeeded.map((p) => p.userId).filter(Boolean)).size;
    const byPlanArray = [
      { planId: '1month', count: byPlan['1month'] ?? 0 },
      { planId: '6months', count: byPlan['6months'] ?? 0 },
      { planId: '1year', count: byPlan['1year'] ?? 0 },
    ];
    return {
      code: promo.code,
      usersCount,
      byPlan: byPlanArray,
      totalAmountRub: Math.round(totalAmount * 100) / 100,
      paymentsCount: succeeded.length,
    };
  }

  async delete(promoId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id: promoId } });
    if (!promo) throw new BadRequestException('Промокод не найден');
    await this.prisma.promoCode.delete({ where: { id: promoId } });
    return { success: true };
  }

  private toResponse(p: { id: string; code: string; name: string; discountType: string; discountValue: number; validFrom: Date; validUntil: Date; createdAt: Date; _count?: { payments: number } }) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      discountType: p.discountType,
      discountValue: p.discountValue,
      validFrom: p.validFrom.toISOString(),
      validUntil: p.validUntil.toISOString(),
      createdAt: p.createdAt.toISOString(),
      paymentsCount: (p as { _count?: { payments: number } })._count?.payments ?? 0,
    };
  }
}
