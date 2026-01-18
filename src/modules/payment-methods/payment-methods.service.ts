import { Injectable } from '@nestjs/common';
import { PaymentMethodType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentMethodsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: number, type?: PaymentMethodType) {
    return this.prisma.paymentMethod.findMany({
      where: {
        ...(type ? { type } : {}),
        OR: [{ userId }, { isSystem: true }],
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        iconKey: true,
        sortOrder: true,
        isSystem: true,
        creditAccountId: true,
      },
    });
  }
}

