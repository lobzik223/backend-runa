import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Service to gather user's financial context for AI chat.
 * Provides structured data about user's financial situation.
 */
export interface FinanceContext {
  // Income/Expense totals for current month
  currentMonth: {
    income: number;
    expense: number;
    net: number;
  };

  // Category breakdown
  topExpenseCategories: Array<{ category: string; amount: number }>;
  topIncomeCategories: Array<{ category: string; amount: number }>;

  // Recent transactions (last 10)
  recentTransactions: Array<{
    type: 'INCOME' | 'EXPENSE';
    amount: number;
    category: string;
    date: string;
    note?: string | null;
  }>;

  // Goals progress
  goals: Array<{
    name: string;
    targetAmount: number;
    currentAmount: number;
    progressPercent: number;
    deadline?: Date | null;
  }>;

  // Credit debt status
  creditAccounts: Array<{
    name: string;
    currentDebt: number;
    creditLimit?: number | null;
    nextPaymentDate?: Date | null;
  }>;

  // Investment portfolio summary
  portfolio: {
    totalCost: number;
    totalCurrentValue: number | null;
    totalPnl: number | null;
    assetCount: number;
  };

  // Savings rate (if calculable)
  savingsRate?: number | null;
}

@Injectable()
export class FinanceContextService {
  constructor(private prisma: PrismaService) {}

  async getFinanceContext(userId: number): Promise<FinanceContext> {
    const now = dayjs();
    const monthStart = now.startOf('month').toDate();
    const monthEnd = now.endOf('month').toDate();

    // Get current month transactions
    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        occurredAt: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
      include: {
        category: true,
      },
      orderBy: {
        occurredAt: 'desc',
      },
    });

    // Calculate totals
    let income = 0;
    let expense = 0;
    const categoryExpenses: Record<string, number> = {};
    const categoryIncomes: Record<string, number> = {};

    for (const txn of transactions) {
      const amount = Number(txn.amount);
      const categoryName = txn.category?.name || 'Без категории';

      if (txn.type === 'INCOME') {
        income += amount;
        categoryIncomes[categoryName] = (categoryIncomes[categoryName] || 0) + amount;
      } else {
        expense += amount;
        categoryExpenses[categoryName] = (categoryExpenses[categoryName] || 0) + amount;
      }
    }

    // Top categories
    const topExpenseCategories = Object.entries(categoryExpenses)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const topIncomeCategories = Object.entries(categoryIncomes)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Recent transactions (last 10)
    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId },
      include: { category: true },
      take: 10,
      orderBy: { occurredAt: 'desc' },
    });

    // Goals with contributions
    const goals = await this.prisma.goal.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        contributions: {
          orderBy: {
            occurredAt: 'desc',
          },
        },
      },
    });

    // Credit accounts (use currentBalance as debt)
    const creditAccounts = await this.prisma.creditAccount.findMany({
      where: { userId },
    });

    // Investment portfolio (simplified - get from investments service if available)
    const investmentAssets = await this.prisma.investmentAsset.findMany({
      where: { userId },
      include: {
        lots: {
          where: { soldAt: null },
        },
      },
    });

    let portfolioTotalCost = 0;
    let portfolioAssetCount = 0;
    for (const asset of investmentAssets) {
      for (const lot of asset.lots) {
        portfolioTotalCost += Number(lot.quantity) * Number(lot.pricePerUnit) + Number(lot.fees || 0);
      }
      if (asset.lots.length > 0) {
        portfolioAssetCount++;
      }
    }

    // Calculate savings rate
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : null;

    return {
      currentMonth: {
        income,
        expense,
        net: income - expense,
      },
      topExpenseCategories,
      topIncomeCategories,
      recentTransactions: recentTransactions.map((t) => ({
        type: t.type,
        amount: Number(t.amount),
        category: t.category?.name || 'Без категории',
        date: t.occurredAt.toISOString(),
        note: t.note,
      })),
      goals: goals.map((g) => {
        const currentAmount = g.contributions.reduce((sum, c) => sum + Number(c.amount), 0);
        return {
          name: g.name,
          targetAmount: Number(g.targetAmount),
          currentAmount,
          progressPercent: Number(g.targetAmount) > 0 ? (currentAmount / Number(g.targetAmount)) * 100 : 0,
          deadline: g.targetDate,
        };
      }),
      creditAccounts: creditAccounts.map((ca) => ({
        name: ca.name,
        currentDebt: Number(ca.currentBalance),
        creditLimit: ca.creditLimit ? Number(ca.creditLimit) : null,
        nextPaymentDate: ca.nextPaymentAt,
      })),
      portfolio: {
        totalCost: portfolioTotalCost,
        totalCurrentValue: null, // Would need market data
        totalPnl: null,
        assetCount: portfolioAssetCount,
      },
      savingsRate,
    };
  }
}
