import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DonutChartData {
  chartType: 'donut';
  incomeTotal: number;
  expenseTotal: number;
  incomeByCategory: Array<{ name: string; value: number }>;
  expenseByCategory: Array<{ name: string; value: number }>;
  dateRange: {
    start: string;
    end: string;
  };
}

@Injectable()
export class ChartDataService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate donut chart data for income and expense
   * Includes totals and breakdown by categories
   */
  async getDonutChartData(
    userId: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<DonutChartData> {
    // Default to current month if not specified
    const now = dayjs();
    const start = startDate || now.startOf('month').toDate();
    const end = endDate || now.endOf('month').toDate();

    // Get all transactions in date range
    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        occurredAt: {
          gte: start,
          lte: end,
        },
      },
      include: {
        category: true,
      },
    });

    // Calculate totals and category breakdowns
    let incomeTotal = 0;
    let expenseTotal = 0;
    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};

    for (const txn of transactions) {
      const amount = Number(txn.amount);
      const categoryName = txn.category?.name || 'Без категории';

      if (txn.type === 'INCOME') {
        incomeTotal += amount;
        incomeByCategory[categoryName] = (incomeByCategory[categoryName] || 0) + amount;
      } else {
        expenseTotal += amount;
        expenseByCategory[categoryName] = (expenseByCategory[categoryName] || 0) + amount;
      }
    }

    // Convert to arrays and sort by value
    const incomeByCategoryArray = Object.entries(incomeByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const expenseByCategoryArray = Object.entries(expenseByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      chartType: 'donut',
      incomeTotal,
      expenseTotal,
      incomeByCategory: incomeByCategoryArray,
      expenseByCategory: expenseByCategoryArray,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  }
}
