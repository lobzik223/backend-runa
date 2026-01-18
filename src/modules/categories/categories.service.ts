import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryType } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: number, type?: CategoryType) {
    return this.prisma.category.findMany({
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
        parentId: true,
        sortOrder: true,
        isSystem: true,
      },
    });
  }
}

