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
    return list.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      discountRubles: p.discountRubles,
      validFrom: p.validFrom.toISOString(),
      validUntil: p.validUntil.toISOString(),
      createdAt: p.createdAt.toISOString(),
      paymentsCount: p._count.payments,
    }));
  }

  async create(dto: { code: string; name: string; discountRubles: number; validUntil: string }) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    const name = String(dto.name ?? '').trim();
    const discountRubles = Math.max(0, Math.floor(Number(dto.discountRubles) || 0));
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
        discountRubles,
        validUntil,
      },
    });
    return {
      id: created.id,
      code: created.code,
      name: created.name,
      discountRubles: created.discountRubles,
      validFrom: created.validFrom.toISOString(),
      validUntil: created.validUntil.toISOString(),
      createdAt: created.createdAt.toISOString(),
    };
  }
}
