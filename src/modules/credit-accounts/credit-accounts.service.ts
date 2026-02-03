import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { CreateCreditAccountDto } from './dto/create-credit-account.dto';
import { UpdateCreditAccountDto } from './dto/update-credit-account.dto';
import { ScheduledEventsService } from '../scheduled-events/scheduled-events.service';
import { InterestCalculatorService } from '../scheduled-events/interest-calculator.service';

const FREE_CREDITS_LIMIT = 2;
const PREMIUM_CREDITS_LIMIT = 100;

@Injectable()
export class CreditAccountsService {
  constructor(
    private prisma: PrismaService,
    private scheduledEventsService: ScheduledEventsService,
    private interestCalculator: InterestCalculatorService,
    private entitlements: EntitlementsService,
  ) {}

  async create(userId: number, dto: CreateCreditAccountDto) {
    const isPremium = await this.entitlements.isPremium(userId);
    const limit = isPremium ? PREMIUM_CREDITS_LIMIT : FREE_CREDITS_LIMIT;
    const count = await this.prisma.creditAccount.count({ where: { userId } });
    if (count >= limit) {
      throw new ForbiddenException(
        isPremium ? 'CREDITS_LIMIT_REACHED' : 'CREDITS_FREE_LIMIT_REACHED',
      );
    }

    // Validate credit_limit >= currentBalance for credit cards
    if (dto.kind === 'CREDIT_CARD' && dto.creditLimit !== undefined && dto.currentBalance !== undefined) {
      if (dto.currentBalance > dto.creditLimit) {
        throw new BadRequestException('Current balance cannot exceed credit limit');
      }
    }

    const currentBalance = dto.currentBalance || 0;
    const nextPaymentAt = dto.nextPaymentAt ? new Date(dto.nextPaymentAt) : new Date();

    // Use transaction to create account and scheduled event atomically
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.create({
        data: {
          userId,
          kind: dto.kind,
          name: dto.name,
          currency: dto.currency || 'RUB',
          principal: dto.principal,
          currentBalance,
          creditLimit: dto.creditLimit,
          billingDay: dto.billingDay,
          interestRate: dto.interestRate,
          paymentDay: dto.paymentDay,
          nextPaymentAt,
          minimumPayment: dto.minimumPayment,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : null,
        },
      });

      // For credit cards, create a selectable payment method linked to this credit account.
      // This enables automatic debt sync when user records an EXPENSE with this payment method.
      if (dto.kind === 'CREDIT_CARD') {
        await tx.paymentMethod.create({
          data: {
            userId,
            type: 'CREDIT_CARD',
            name: dto.name,
            iconKey: 'credit',
            sortOrder: 30,
            creditAccountId: account.id,
          },
        });
      }

      // Create scheduled event for LOAN payment if it's a loan with APR and next payment date
      if (dto.kind === 'LOAN' && dto.interestRate !== undefined && dto.interestRate > 0) {
        const paymentAmount = this.interestCalculator.calculateLoanPayment(
          currentBalance,
          dto.interestRate,
          dto.minimumPayment,
        );

        await tx.scheduledEvent.create({
          data: {
            userId,
            kind: 'CREDIT_PAYMENT',
            creditAccountId: account.id,
            dueAt: nextPaymentAt,
            amount: paymentAmount,
            currency: dto.currency || 'RUB',
            note: `Loan payment for: ${dto.name}`,
          },
        });
      }

      return account;
    });

    return result;
  }

  async findAll(userId: number) {
    return this.prisma.creditAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: number, id: number) {
    const account = await this.prisma.creditAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('Credit account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('Credit account does not belong to user');
    }

    return account;
  }

  async update(userId: number, id: number, dto: UpdateCreditAccountDto) {
    const account = await this.findOne(userId, id);

    // Validate credit_limit >= currentBalance for credit cards
    const newBalance = dto.currentBalance !== undefined ? dto.currentBalance : Number(account.currentBalance);
    const newLimit = dto.creditLimit !== undefined ? dto.creditLimit : (account.creditLimit ? Number(account.creditLimit) : null);

    if (account.kind === 'CREDIT_CARD' && newLimit !== null && newBalance > newLimit) {
      throw new BadRequestException('Current balance cannot exceed credit limit');
    }

    // Prevent negative balance
    if (dto.currentBalance !== undefined && dto.currentBalance < 0) {
      throw new BadRequestException('Current balance cannot be negative');
    }

    const updatedBalance = dto.currentBalance !== undefined ? dto.currentBalance : Number(account.currentBalance);
    const updatedApr = dto.interestRate !== undefined ? dto.interestRate : (account.interestRate ? Number(account.interestRate) : null);
    const updatedNextPaymentAt = dto.nextPaymentAt !== undefined
      ? (dto.nextPaymentAt ? new Date(dto.nextPaymentAt) : null)
      : (account.nextPaymentAt ? new Date(account.nextPaymentAt) : null);

    // Check if we need to reschedule loan payment
    const needsReschedule =
      account.kind === 'LOAN' &&
      (dto.currentBalance !== undefined ||
        dto.interestRate !== undefined ||
        dto.nextPaymentAt !== undefined ||
        dto.minimumPayment !== undefined) &&
      updatedApr !== null &&
      updatedApr > 0 &&
      updatedNextPaymentAt !== null;

    // Use transaction to update account and scheduled event atomically
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditAccount.update({
        where: { id },
        data: {
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.principal !== undefined && { principal: dto.principal }),
          ...(dto.currentBalance !== undefined && { currentBalance: dto.currentBalance }),
          ...(dto.creditLimit !== undefined && { creditLimit: dto.creditLimit }),
          ...(dto.billingDay !== undefined && { billingDay: dto.billingDay }),
          ...(dto.interestRate !== undefined && { interestRate: dto.interestRate }),
          ...(dto.paymentDay !== undefined && { paymentDay: dto.paymentDay }),
          ...(dto.nextPaymentAt !== undefined && { nextPaymentAt: dto.nextPaymentAt ? new Date(dto.nextPaymentAt) : null }),
          ...(dto.minimumPayment !== undefined && { minimumPayment: dto.minimumPayment }),
          ...(dto.openedAt !== undefined && { openedAt: dto.openedAt ? new Date(dto.openedAt) : null }),
          ...(dto.closedAt !== undefined && { closedAt: dto.closedAt ? new Date(dto.closedAt) : null }),
        },
      });

      // Update scheduled event if needed
      if (needsReschedule) {
        // Delete existing scheduled events
        await tx.scheduledEvent.deleteMany({
          where: {
            userId,
            creditAccountId: id,
            kind: 'CREDIT_PAYMENT',
            status: 'SCHEDULED',
          },
        });

        // Create new scheduled event
        const updatedMinimumPayment = dto.minimumPayment !== undefined
          ? dto.minimumPayment
          : (updated.minimumPayment ? Number(updated.minimumPayment) : null);

        const paymentAmount = this.interestCalculator.calculateLoanPayment(
          updatedBalance,
          updatedApr!,
          updatedMinimumPayment,
        );

        await tx.scheduledEvent.create({
          data: {
            userId,
            kind: 'CREDIT_PAYMENT',
            creditAccountId: id,
            dueAt: updatedNextPaymentAt!,
            amount: paymentAmount,
            currency: updated.currency,
            note: `Loan payment for: ${updated.name}`,
          },
        });
      }

      return updated;
    });

    return result;
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id); // Check ownership

    // Use transaction to delete account and scheduled events atomically
    await this.prisma.$transaction(async (tx) => {
      // Delete scheduled events first
      await tx.scheduledEvent.deleteMany({
        where: {
          creditAccountId: id,
        },
      });

      // Delete account
      await tx.creditAccount.delete({
        where: { id },
      });
    });

    return { message: 'Credit account deleted successfully' };
  }

  /**
   * Atomically update credit account debt.
   * Used by TransactionsService when transactions are created/updated/deleted.
   */
  async updateDebtAtomic(
    creditAccountId: number,
    delta: number, // positive = increase debt, negative = decrease debt
  ): Promise<void> {
    // Use Prisma transaction for atomicity
    await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { id: creditAccountId },
        select: { currentBalance: true },
      });

      if (!account) {
        throw new NotFoundException('Credit account not found');
      }

      const currentBalance = Number(account.currentBalance);
      const newBalance = currentBalance + delta;

      if (newBalance < 0) {
        throw new BadRequestException('Credit account balance cannot be negative');
      }

      await tx.creditAccount.update({
        where: { id: creditAccountId },
        data: { currentBalance: newBalance },
      });
    });
  }
}
