import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { CreateDepositAccountDto } from './dto/create-deposit-account.dto';
import { UpdateDepositAccountDto } from './dto/update-deposit-account.dto';
import { ScheduledEventsService } from '../scheduled-events/scheduled-events.service';
import { InterestCalculatorService } from '../scheduled-events/interest-calculator.service';

const FREE_DEPOSITS_LIMIT = 2;
const PREMIUM_DEPOSITS_LIMIT = 100;

@Injectable()
export class DepositAccountsService {
  constructor(
    private prisma: PrismaService,
    private scheduledEventsService: ScheduledEventsService,
    private interestCalculator: InterestCalculatorService,
    private entitlements: EntitlementsService,
  ) {}

  async create(userId: number, dto: CreateDepositAccountDto) {
    const isPremium = await this.entitlements.isPremium(userId);
    const limit = isPremium ? PREMIUM_DEPOSITS_LIMIT : FREE_DEPOSITS_LIMIT;
    const count = await this.prisma.depositAccount.count({ where: { userId } });
    if (count >= limit) {
      throw new ForbiddenException(
        isPremium ? 'DEPOSITS_LIMIT_REACHED' : 'DEPOSITS_FREE_LIMIT_REACHED',
      );
    }

    const payoutSchedule = dto.payoutSchedule || 'MONTHLY';
    const nextPayoutAt = dto.nextPayoutAt ? new Date(dto.nextPayoutAt) : new Date();

    // Calculate first interest amount
    const interestAmount = this.interestCalculator.calculateDepositInterest(
      dto.principal,
      dto.interestRate,
    );

    // Use transaction to create account and scheduled event atomically
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.depositAccount.create({
        data: {
          userId,
          name: dto.name,
          currency: dto.currency || 'RUB',
          principal: dto.principal,
          interestRate: dto.interestRate,
          payoutSchedule,
          nextPayoutAt,
          maturityAt: dto.maturityAt ? new Date(dto.maturityAt) : null,
        },
      });

      // Create scheduled event for interest payout
      if (payoutSchedule !== 'AT_MATURITY' || dto.maturityAt) {
        const dueAt = payoutSchedule === 'AT_MATURITY' && dto.maturityAt
          ? new Date(dto.maturityAt)
          : nextPayoutAt;

        await tx.scheduledEvent.create({
          data: {
            userId,
            kind: 'DEPOSIT_INTEREST',
            depositAccountId: account.id,
            dueAt,
            amount: interestAmount,
            currency: dto.currency || 'RUB',
            note: `Interest payout for deposit: ${dto.name}`,
          },
        });
      }

      return account;
    });

    return result;
  }

  async findAll(userId: number) {
    return this.prisma.depositAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: number, id: number) {
    const account = await this.prisma.depositAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('Deposit account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('Deposit account does not belong to user');
    }

    return account;
  }

  async update(userId: number, id: number, dto: UpdateDepositAccountDto) {
    const account = await this.findOne(userId, id);

    const updatedPrincipal = dto.principal !== undefined ? dto.principal : Number(account.principal);
    const updatedApr = dto.interestRate !== undefined ? dto.interestRate : Number(account.interestRate);
    const updatedSchedule = dto.payoutSchedule !== undefined ? dto.payoutSchedule : account.payoutSchedule;

    // Recalculate interest amount if principal or APR changed
    const needsReschedule =
      dto.principal !== undefined ||
      dto.interestRate !== undefined ||
      dto.payoutSchedule !== undefined ||
      dto.nextPayoutAt !== undefined;

    // Use transaction to update account and scheduled event atomically
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.depositAccount.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.principal !== undefined && { principal: dto.principal }),
          ...(dto.interestRate !== undefined && { interestRate: dto.interestRate }),
          ...(dto.payoutSchedule !== undefined && { payoutSchedule: dto.payoutSchedule }),
          ...(dto.nextPayoutAt !== undefined && { nextPayoutAt: dto.nextPayoutAt ? new Date(dto.nextPayoutAt) : null }),
          ...(dto.maturityAt !== undefined && { maturityAt: dto.maturityAt ? new Date(dto.maturityAt) : null }),
        },
      });

      // Update scheduled event if needed
      if (needsReschedule) {
        // Delete existing scheduled events
        await tx.scheduledEvent.deleteMany({
          where: {
            userId,
            depositAccountId: id,
            kind: 'DEPOSIT_INTEREST',
            status: 'SCHEDULED',
          },
        });

        // Create new scheduled event
        const nextPayoutAt = dto.nextPayoutAt
          ? new Date(dto.nextPayoutAt)
          : (updated.nextPayoutAt ? new Date(updated.nextPayoutAt) : new Date());

        const interestAmount = this.interestCalculator.calculateDepositInterest(
          updatedPrincipal,
          updatedApr,
        );

        if (updatedSchedule !== 'AT_MATURITY' || updated.maturityAt) {
          const dueAt = updatedSchedule === 'AT_MATURITY' && updated.maturityAt
            ? new Date(updated.maturityAt)
            : nextPayoutAt;

          await tx.scheduledEvent.create({
            data: {
              userId,
              kind: 'DEPOSIT_INTEREST',
              depositAccountId: id,
              dueAt,
              amount: interestAmount,
              currency: updated.currency,
              note: `Interest payout for deposit: ${updated.name}`,
            },
          });
        }
      }

      return updated;
    });

    return result;
  }

  async remove(userId: number, id: number) {
    const account = await this.findOne(userId, id);

    // Use transaction to delete account and scheduled events atomically
    await this.prisma.$transaction(async (tx) => {
      // Delete scheduled events first
      await tx.scheduledEvent.deleteMany({
        where: {
          depositAccountId: id,
        },
      });

      // Delete account
      await tx.depositAccount.delete({
        where: { id },
      });
    });

    return { message: 'Deposit account deleted successfully' };
  }
}
