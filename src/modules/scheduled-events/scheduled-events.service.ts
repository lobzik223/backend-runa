import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledEventKind } from '@prisma/client';

/**
 * Service for managing scheduled events (loan payments, deposit interest, etc.)
 */
@Injectable()
export class ScheduledEventsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create or update scheduled event for a credit account (loan payment)
   */
  async upsertCreditPaymentEvent(
    userId: number,
    creditAccountId: number,
    dueAt: Date,
    amount: number,
    currency: string = 'RUB',
  ) {
    // Delete existing scheduled events for this credit account
    await this.prisma.scheduledEvent.deleteMany({
      where: {
        userId,
        creditAccountId,
        kind: ScheduledEventKind.CREDIT_PAYMENT,
        status: 'SCHEDULED',
      },
    });

    // Create new scheduled event
    return this.prisma.scheduledEvent.create({
      data: {
        userId,
        kind: ScheduledEventKind.CREDIT_PAYMENT,
        creditAccountId,
        dueAt,
        amount,
        currency,
        note: `Loan payment for credit account #${creditAccountId}`,
      },
    });
  }

  /**
   * Create or update scheduled event for a deposit account (interest payout)
   */
  async upsertDepositInterestEvent(
    userId: number,
    depositAccountId: number,
    dueAt: Date,
    amount: number,
    currency: string = 'RUB',
  ) {
    // Delete existing scheduled events for this deposit account
    await this.prisma.scheduledEvent.deleteMany({
      where: {
        userId,
        depositAccountId,
        kind: ScheduledEventKind.DEPOSIT_INTEREST,
        status: 'SCHEDULED',
      },
    });

    // Create new scheduled event
    return this.prisma.scheduledEvent.create({
      data: {
        userId,
        kind: ScheduledEventKind.DEPOSIT_INTEREST,
        depositAccountId,
        dueAt,
        amount,
        currency,
        note: `Interest payout for deposit account #${depositAccountId}`,
      },
    });
  }

  /**
   * Delete all scheduled events for a credit account
   */
  async deleteCreditAccountEvents(creditAccountId: number) {
    return this.prisma.scheduledEvent.deleteMany({
      where: {
        creditAccountId,
        kind: ScheduledEventKind.CREDIT_PAYMENT,
        status: 'SCHEDULED',
      },
    });
  }

  /**
   * Delete all scheduled events for a deposit account
   */
  async deleteDepositAccountEvents(depositAccountId: number) {
    return this.prisma.scheduledEvent.deleteMany({
      where: {
        depositAccountId,
        kind: ScheduledEventKind.DEPOSIT_INTEREST,
        status: 'SCHEDULED',
      },
    });
  }
}
