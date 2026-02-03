import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { AnalyticsDto } from './dto/analytics.dto';
import { TransactionType } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private creditAccountsService: CreditAccountsService,
  ) {}

  private serializeTransaction(t: any) {
    if (!t) return t;
    return {
      ...t,
      id: typeof t.id === 'bigint' ? t.id.toString() : t.id,
      amount: t.amount !== undefined && t.amount !== null ? Number(t.amount) : t.amount,
      occurredAt: t.occurredAt instanceof Date ? t.occurredAt.toISOString() : t.occurredAt,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
      updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
      category: t.category
        ? {
            id: t.category.id,
            name: t.category.name,
            iconKey: t.category.iconKey ?? (t.category as any).parent?.iconKey ?? null,
          }
        : t.category,
      paymentMethod: t.paymentMethod
        ? {
            id: t.paymentMethod.id,
            name: t.paymentMethod.name,
            creditAccountId: t.paymentMethod.creditAccountId ?? null,
            creditAccount: t.paymentMethod.creditAccount
              ? {
                  id: t.paymentMethod.creditAccount.id,
                  kind: t.paymentMethod.creditAccount.kind,
                  name: t.paymentMethod.creditAccount.name,
                  currentBalance: Number(t.paymentMethod.creditAccount.currentBalance),
                  creditLimit: t.paymentMethod.creditAccount.creditLimit
                    ? Number(t.paymentMethod.creditAccount.creditLimit)
                    : null,
                }
              : null,
          }
        : t.paymentMethod,
    };
  }

  async create(userId: number, dto: CreateTransactionDto) {
    // Validate category belongs to user or is system
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
      if (category.userId !== null && category.userId !== userId) {
        throw new ForbiddenException('Category does not belong to user');
      }
      if (category.type !== dto.type) {
        throw new BadRequestException('Category type does not match transaction type');
      }
    }

    // Validate payment method belongs to user or is system
    let paymentMethod: any = null;
    if (dto.paymentMethodId) {
      paymentMethod = await this.prisma.paymentMethod.findUnique({
        where: { id: dto.paymentMethodId },
        include: { creditAccount: true },
      });
      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found');
      }
      if (paymentMethod.userId !== null && paymentMethod.userId !== userId) {
        throw new ForbiddenException('Payment method does not belong to user');
      }
    }

    // Use Prisma transaction for atomicity when updating credit account debt
    const transaction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId,
          type: dto.type,
          amount: dto.amount,
          currency: dto.currency || 'RUB',
          occurredAt: new Date(dto.occurredAt),
          note: dto.note,
          categoryId: dto.categoryId,
          paymentMethodId: dto.paymentMethodId,
        },
        include: {
          category: { include: { parent: true } },
          paymentMethod: {
            include: {
              creditAccount: true,
            },
          },
        },
      });

      // Update credit account debt if payment method is linked to credit account and transaction is expense
      if (paymentMethod?.creditAccountId && dto.type === TransactionType.EXPENSE) {
        await this.creditAccountsService.updateDebtAtomic(
          paymentMethod.creditAccountId,
          dto.amount, // Increase debt
        );
      }

      return created;
    });

    // Fetch updated credit account data
    if (transaction.paymentMethod?.creditAccountId) {
      const updatedPaymentMethod = await this.prisma.paymentMethod.findUnique({
        where: { id: transaction.paymentMethodId! },
        include: { creditAccount: true },
      });
      if (updatedPaymentMethod) {
        transaction.paymentMethod = updatedPaymentMethod;
      }
    }

    return this.serializeTransaction(transaction);
  }

  async findAll(userId: number, dto: ListTransactionsDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const timezone = dto.timezone || 'UTC';
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (dto.from) {
      fromDate = dayjs.tz(dto.from, timezone).startOf('day').utc().toDate();
    }
    if (dto.to) {
      toDate = dayjs.tz(dto.to, timezone).endOf('day').utc().toDate();
    }

    const where: any = {
      userId,
    };

    if (dto.type) {
      where.type = dto.type;
    }

    if (fromDate || toDate) {
      where.occurredAt = {};
      if (fromDate) where.occurredAt.gte = fromDate;
      if (toDate) where.occurredAt.lte = toDate;
    }

    if (dto.categoryId) {
      where.categoryId = dto.categoryId;
    }

    if (dto.paymentMethodId) {
      where.paymentMethodId = dto.paymentMethodId;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          category: { include: { parent: true } },
          paymentMethod: {
            include: {
              creditAccount: true,
            },
          },
        },
        orderBy: {
          occurredAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions.map((t) => this.serializeTransaction(t)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: number, id: bigint) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        category: { include: { parent: true } },
        paymentMethod: {
          include: {
            creditAccount: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenException('Transaction does not belong to user');
    }

    return this.serializeTransaction(transaction);
  }

  async update(userId: number, id: bigint, dto: UpdateTransactionDto) {
    const transaction = await this.findOne(userId, id);

    // Get old payment method with credit account
    const oldPaymentMethod = transaction.paymentMethodId
      ? await this.prisma.paymentMethod.findUnique({
          where: { id: transaction.paymentMethodId },
          include: { creditAccount: true },
        })
      : null;

    // Validate category if provided
    if (dto.categoryId !== undefined) {
      if (dto.categoryId !== null) {
        const category = await this.prisma.category.findUnique({
          where: { id: dto.categoryId },
        });
        if (!category) {
          throw new NotFoundException('Category not found');
        }
        if (category.userId !== null && category.userId !== userId) {
          throw new ForbiddenException('Category does not belong to user');
        }
        if (category.type !== (dto.type || transaction.type)) {
          throw new BadRequestException('Category type does not match transaction type');
        }
      }
    }

    // Validate payment method if provided
    let newPaymentMethod: any = null;
    if (dto.paymentMethodId !== undefined) {
      if (dto.paymentMethodId !== null) {
        newPaymentMethod = await this.prisma.paymentMethod.findUnique({
          where: { id: dto.paymentMethodId },
          include: { creditAccount: true },
        });
        if (!newPaymentMethod) {
          throw new NotFoundException('Payment method not found');
        }
        if (newPaymentMethod.userId !== null && newPaymentMethod.userId !== userId) {
          throw new ForbiddenException('Payment method does not belong to user');
        }
      }
    }

    const newType = dto.type !== undefined ? dto.type : transaction.type;
    const newAmount = dto.amount !== undefined ? dto.amount : Number(transaction.amount);
    const oldAmount = Number(transaction.amount);
    const oldType = transaction.type;

    // Use Prisma transaction for atomicity
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTransaction = await tx.transaction.update({
        where: { id },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.occurredAt !== undefined && { occurredAt: new Date(dto.occurredAt) }),
          ...(dto.note !== undefined && { note: dto.note }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.paymentMethodId !== undefined && { paymentMethodId: dto.paymentMethodId }),
        },
        include: {
          category: true,
          paymentMethod: {
            include: {
              creditAccount: true,
            },
          },
        },
      });

      // Calculate debt delta
      // Old transaction: if EXPENSE with credit account, rollback (subtract old amount)
      if (oldType === TransactionType.EXPENSE && oldPaymentMethod?.creditAccountId) {
        await this.creditAccountsService.updateDebtAtomic(
          oldPaymentMethod.creditAccountId,
          -oldAmount, // Decrease debt (rollback)
        );
      }

      // New transaction: if EXPENSE with credit account, add (add new amount)
      const finalPaymentMethod = dto.paymentMethodId !== undefined ? newPaymentMethod : oldPaymentMethod;
      if (newType === TransactionType.EXPENSE && finalPaymentMethod?.creditAccountId) {
        await this.creditAccountsService.updateDebtAtomic(
          finalPaymentMethod.creditAccountId,
          newAmount, // Increase debt
        );
      }

      return updatedTransaction;
    });

    // Fetch updated credit account data
    const finalPaymentMethodId = dto.paymentMethodId !== undefined ? dto.paymentMethodId : transaction.paymentMethodId;
    if (finalPaymentMethodId) {
      const updatedPaymentMethod = await this.prisma.paymentMethod.findUnique({
        where: { id: finalPaymentMethodId },
        include: { creditAccount: true },
      });
      if (updatedPaymentMethod) {
        updated.paymentMethod = updatedPaymentMethod;
      }
    }

    return this.serializeTransaction(updated);
  }

  async remove(userId: number, id: bigint) {
    const transaction = await this.findOne(userId, id); // Check ownership

    // Get payment method with credit account before deletion
    const paymentMethod = transaction.paymentMethodId
      ? await this.prisma.paymentMethod.findUnique({
          where: { id: transaction.paymentMethodId },
          include: { creditAccount: true },
        })
      : null;

    // Use Prisma transaction for atomicity
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.delete({
        where: { id },
      });

      // Rollback debt if transaction was EXPENSE with credit account
      if (transaction.type === TransactionType.EXPENSE && paymentMethod?.creditAccountId) {
        await this.creditAccountsService.updateDebtAtomic(
          paymentMethod.creditAccountId,
          -Number(transaction.amount), // Decrease debt (rollback)
        );
      }
    });

    return { message: 'Transaction deleted successfully' };
  }

  async getAnalytics(userId: number, dto: AnalyticsDto) {
    const timezone = dto.timezone || 'UTC';
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (dto.from) {
      fromDate = dayjs.tz(dto.from, timezone).startOf('day').utc().toDate();
    } else {
      // Default to current month start
      fromDate = dayjs().tz(timezone).startOf('month').utc().toDate();
    }

    if (dto.to) {
      toDate = dayjs.tz(dto.to, timezone).endOf('day').utc().toDate();
    } else {
      // Default to current month end
      toDate = dayjs().tz(timezone).endOf('month').utc().toDate();
    }

    const where = {
      userId,
      occurredAt: {
        gte: fromDate,
        lte: toDate,
      },
    };

    // Get totals
    const [incomeTotal, expenseTotal] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...where, type: TransactionType.INCOME },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...where, type: TransactionType.EXPENSE },
        _sum: { amount: true },
      }),
    ]);

    const incomeSum = Number(incomeTotal._sum.amount || 0);
    const expenseSum = Number(expenseTotal._sum.amount || 0);
    const total = incomeSum + expenseSum;

    // Calculate percentages for donut chart
    const incomePercent = total > 0 ? (incomeSum / total) * 100 : 0;
    const expensePercent = total > 0 ? (expenseSum / total) * 100 : 0;

    // Get breakdown by categories for income
    const incomeTransactions = await this.prisma.transaction.findMany({
      where: { ...where, type: TransactionType.INCOME },
      include: { category: true },
    });

    const incomeByCategory = new Map<number, { category: any; amount: number }>();
    incomeTransactions.forEach((t) => {
      const catId = t.categoryId || 0;
      const catName = t.category?.name || 'Без категории';
      if (!incomeByCategory.has(catId)) {
        incomeByCategory.set(catId, {
          category: { id: catId, name: catName },
          amount: 0,
        });
      }
      const entry = incomeByCategory.get(catId)!;
      entry.amount += Number(t.amount);
    });

    const incomeBreakdown = Array.from(incomeByCategory.values())
      .map((item) => ({
        categoryId: item.category.id,
        categoryName: item.category.name,
        amount: item.amount,
        percent: incomeSum > 0 ? (item.amount / incomeSum) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Get breakdown by categories for expense
    const expenseTransactions = await this.prisma.transaction.findMany({
      where: { ...where, type: TransactionType.EXPENSE },
      include: { category: true },
    });

    const expenseByCategory = new Map<number, { category: any; amount: number }>();
    expenseTransactions.forEach((t) => {
      const catId = t.categoryId || 0;
      const catName = t.category?.name || 'Без категории';
      if (!expenseByCategory.has(catId)) {
        expenseByCategory.set(catId, {
          category: { id: catId, name: catName },
          amount: 0,
        });
      }
      const entry = expenseByCategory.get(catId)!;
      entry.amount += Number(t.amount);
    });

    const expenseBreakdown = Array.from(expenseByCategory.values())
      .map((item) => ({
        categoryId: item.category.id,
        categoryName: item.category.name,
        amount: item.amount,
        percent: expenseSum > 0 ? (item.amount / expenseSum) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        timezone,
      },
      totals: {
        income: incomeSum,
        expense: expenseSum,
        total,
      },
      donutChart: {
        incomePercent: Math.round(incomePercent * 100) / 100,
        expensePercent: Math.round(expensePercent * 100) / 100,
      },
      breakdown: {
        income: incomeBreakdown,
        expense: expenseBreakdown,
      },
    };
  }
}
