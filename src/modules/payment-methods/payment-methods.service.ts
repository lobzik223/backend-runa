import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethodType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { WalletCardSyncItemDto } from './dto/sync-wallet-cards.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(private prisma: PrismaService) {}

  private mapRow(pm: {
    id: number;
    type: PaymentMethodType;
    name: string;
    iconKey: string | null;
    sortOrder: number;
    isSystem: boolean;
    creditAccountId: number | null;
    clientId: string | null;
    balance: Prisma.Decimal | null;
    last4: string | null;
    network: string | null;
    design: string | null;
    coverImageKey: string | null;
    cardCurrency: string | null;
  }) {
    return {
      id: pm.id,
      type: pm.type,
      name: pm.name,
      iconKey: pm.iconKey,
      sortOrder: pm.sortOrder,
      isSystem: pm.isSystem,
      creditAccountId: pm.creditAccountId,
      clientId: pm.clientId,
      balance: pm.balance != null ? Number(pm.balance) : null,
      last4: pm.last4,
      network: pm.network,
      design: pm.design,
      coverImageKey: pm.coverImageKey,
      cardCurrency: pm.cardCurrency,
    };
  }

  async list(userId: number, type?: PaymentMethodType) {
    const rows = await this.prisma.paymentMethod.findMany({
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
        clientId: true,
        balance: true,
        last4: true,
        network: true,
        design: true,
        coverImageKey: true,
        cardCurrency: true,
      },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async syncWalletCards(userId: number, cards: WalletCardSyncItemDto[]) {
    if (cards.length > 2) {
      throw new BadRequestException('Не более одной дебетовой и одной кредитной карты.');
    }
    const debits = cards.filter((c) => c.type === PaymentMethodType.DEBIT_CARD);
    const credits = cards.filter((c) => c.type === PaymentMethodType.CREDIT_CARD);
    if (debits.length > 1 || credits.length > 1) {
      throw new BadRequestException('Не более одной карты каждого типа.');
    }

    const incomingIds = cards.map((c) => c.clientId);

    await this.prisma.$transaction(async (tx) => {
      const walletCardTypes: PaymentMethodType[] = [PaymentMethodType.DEBIT_CARD, PaymentMethodType.CREDIT_CARD];
      const walletTypeFilter = {
        userId,
        creditAccountId: null,
        type: { in: walletCardTypes },
      };
      if (incomingIds.length === 0) {
        await tx.paymentMethod.deleteMany({ where: walletTypeFilter });
      } else {
        await tx.paymentMethod.deleteMany({
          where: {
            ...walletTypeFilter,
            OR: [{ clientId: null }, { clientId: { notIn: incomingIds } }],
          },
        });
      }

      for (const c of cards) {
        const existing = await tx.paymentMethod.findFirst({
          where: { userId, clientId: c.clientId },
        });
        const balance = c.balance ?? 0;
        const iconKey = c.type === PaymentMethodType.DEBIT_CARD ? 'debit' : 'credit';
        const sortOrder = c.type === PaymentMethodType.DEBIT_CARD ? 20 : 25;

        if (existing) {
          await tx.paymentMethod.update({
            where: { id: existing.id },
            data: {
              type: c.type,
              name: c.name,
              iconKey,
              balance,
              last4: c.last4 ?? null,
              network: c.network ?? null,
              design: c.design ?? null,
              coverImageKey: c.coverImageKey ?? null,
              cardCurrency: c.cardCurrency ?? 'RUB',
            },
          });
        } else {
          try {
            await tx.paymentMethod.create({
              data: {
                user: { connect: { id: userId } },
                type: c.type,
                name: c.name,
                iconKey,
                sortOrder,
                isSystem: false,
                clientId: c.clientId,
                balance,
                last4: c.last4 ?? null,
                network: c.network ?? null,
                design: c.design ?? null,
                coverImageKey: c.coverImageKey ?? null,
                cardCurrency: c.cardCurrency ?? 'RUB',
              },
            });
          } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code === 'P2002') {
              await tx.paymentMethod.create({
                data: {
                  user: { connect: { id: userId } },
                  type: c.type,
                  name: `${c.name} · ${c.last4 ?? c.clientId.slice(-4)}`,
                  iconKey,
                  sortOrder,
                  isSystem: false,
                  clientId: c.clientId,
                  balance,
                  last4: c.last4 ?? null,
                  network: c.network ?? null,
                  design: c.design ?? null,
                  coverImageKey: c.coverImageKey ?? null,
                  cardCurrency: c.cardCurrency ?? 'RUB',
                },
              });
            } else {
              throw e;
            }
          }
        }
      }
    });

    return this.list(userId);
  }
}

