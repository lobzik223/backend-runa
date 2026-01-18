import { Injectable } from '@nestjs/common';
import { FinanceContext } from './finance-context.service';

/**
 * Structured output from AI rules engine
 */
export interface AIStructuredOutput {
  type: 'insight' | 'plan' | 'chart_request' | 'warning';
  payload: {
    title: string;
    description?: string;
    severity?: 'info' | 'warning' | 'critical';
    suggestions?: string[];
    chartType?: 'expense_breakdown' | 'income_trend' | 'goal_progress' | 'debt_timeline' | 'donut';
    data?: Record<string, any>;
  };
}

/**
 * Deterministic rules engine for AI financial insights.
 * Detects scenarios and generates structured outputs.
 * LLM is used only for natural language phrasing.
 */
@Injectable()
export class AIRulesEngineService {
  /**
   * Analyze finance context and generate structured insights
   */
  analyze(context: FinanceContext): AIStructuredOutput[] {
    const outputs: AIStructuredOutput[] = [];

    // Rule 1: Budget deficit
    if (context.currentMonth.net < 0) {
      outputs.push({
        type: 'warning',
        payload: {
          title: 'Дефицит бюджета',
          description: `В этом месяце расходы превышают доходы на ${Math.abs(context.currentMonth.net).toLocaleString('ru-RU')} ₽`,
          severity: 'critical',
          suggestions: [
            'Пересмотрите крупные расходы',
            'Рассмотрите возможность сокращения необязательных трат',
            'Проверьте подписки и регулярные платежи',
          ],
        },
      });
    }

    // Rule 2: Overspending categories
    const topExpense = context.topExpenseCategories[0];
    if (topExpense && topExpense.amount > context.currentMonth.expense * 0.4) {
      outputs.push({
        type: 'insight',
        payload: {
          title: 'Большая доля расходов в одной категории',
          description: `Категория "${topExpense.category}" составляет ${((topExpense.amount / context.currentMonth.expense) * 100).toFixed(1)}% всех расходов`,
          severity: 'warning',
          suggestions: ['Проверьте, можно ли оптимизировать расходы в этой категории'],
        },
      });
    }

    // Rule 3: No savings
    if (context.savingsRate !== null && context.savingsRate !== undefined && context.savingsRate < 10) {
      outputs.push({
        type: 'warning',
        payload: {
          title: 'Низкая норма сбережений',
          description: `Норма сбережений составляет ${context.savingsRate.toFixed(1)}%`,
          severity: 'warning',
          suggestions: [
            'Рекомендуется откладывать минимум 10-20% дохода',
            'Настройте автоматические переводы на сбережения',
          ],
        },
      });
    }

    // Rule 4: Sudden spend spike
    // (Would need historical data - simplified for now)
    if (context.currentMonth.expense > 0 && context.recentTransactions.length > 0) {
      const recentLargeExpense = context.recentTransactions.find(
        (t) => t.type === 'EXPENSE' && t.amount > context.currentMonth.expense * 0.2,
      );
      if (recentLargeExpense) {
        outputs.push({
          type: 'insight',
          payload: {
            title: 'Крупная трата',
            description: `Недавно была совершена крупная трата: ${recentLargeExpense.amount.toLocaleString('ru-RU')} ₽ в категории "${recentLargeExpense.category}"`,
            severity: 'info',
          },
        });
      }
    }

    // Rule 5: Goal feasibility
    for (const goal of context.goals) {
      if (goal.deadline) {
        const monthsRemaining = Math.max(1, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)));
        const monthlyNeeded = (goal.targetAmount - goal.currentAmount) / monthsRemaining;
        const monthlyAvailable = context.currentMonth.net;

        if (monthlyAvailable > 0 && monthlyNeeded > monthlyAvailable * 1.5) {
          outputs.push({
            type: 'warning',
            payload: {
              title: `Цель "${goal.name}" может быть недостижима`,
              description: `Для достижения цели нужно откладывать ${monthlyNeeded.toLocaleString('ru-RU')} ₽/месяц, но доступно только ${monthlyAvailable.toLocaleString('ru-RU')} ₽/месяц`,
              severity: 'warning',
              suggestions: [
                'Рассмотрите возможность продления дедлайна',
                'Увеличьте доходы или сократите расходы',
              ],
            },
          });
        }
      }
    }

    // Rule 6: High credit debt
    const totalDebt = context.creditAccounts.reduce((sum, ca) => sum + ca.currentDebt, 0);
    if (totalDebt > 0 && context.currentMonth.income > 0) {
      const debtToIncomeRatio = (totalDebt / context.currentMonth.income) * 100;
      if (debtToIncomeRatio > 50) {
        outputs.push({
          type: 'warning',
          payload: {
            title: 'Высокий уровень долга',
            description: `Общий долг составляет ${totalDebt.toLocaleString('ru-RU')} ₽ (${debtToIncomeRatio.toFixed(1)}% от месячного дохода)`,
            severity: 'critical',
            suggestions: [
              'Приоритизируйте погашение долгов',
              'Избегайте новых займов',
              'Рассмотрите рефинансирование',
            ],
          },
        });
      }
    }

    // Rule 7: Chart requests for better visualization
    // This will be handled by detecting "show charts" in user message
    // See AIChatService for chart request generation

    // Rule 8: Forecast (1-6 months)
    if (context.currentMonth.net > 0 && context.savingsRate !== null && context.savingsRate !== undefined && context.savingsRate > 0) {
      const monthlySavings = context.currentMonth.net;
      const forecastMonths = [1, 3, 6];
      const forecasts = forecastMonths.map((months) => ({
        months,
        projectedSavings: monthlySavings * months,
      }));

      outputs.push({
        type: 'plan',
        payload: {
          title: 'Прогноз накоплений',
          description: `При текущей норме сбережений ${context.savingsRate.toFixed(1)}%:`,
          data: { forecasts },
        },
      });
    }

    return outputs;
  }
}
