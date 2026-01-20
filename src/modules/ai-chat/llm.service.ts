import { Injectable, Logger } from '@nestjs/common';
import { AIStructuredOutput } from './ai-rules-engine.service';

/**
 * LLM service for natural language generation.
 * Converts structured outputs from rules engine into human-friendly text.
 */
export interface LLMResponse {
  text: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
  model?: string;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  // Timeweb Cloud AI configuration
  private readonly timewebAccessId = process.env.TIMEWEB_AI_ACCESS_ID;
  private readonly timewebApiUrl = process.env.TIMEWEB_AI_API_URL || 
    `https://agent.timeweb.cloud/api/v1/cloud-ai/agents/${process.env.TIMEWEB_AI_ACCESS_ID || '009e0398-152a-4a94-84f0-65f32c7aacdc'}/v1`;
  // Legacy OpenAI support
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly openaiModel = process.env.OPENAI_MODEL || 'gpt-5-nano';
  
  private get useTimewebAI(): boolean {
    return !!this.timewebAccessId || !!this.timewebApiUrl;
  }

  /**
   * Convert structured outputs to natural language
   */
  async generateResponse(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    // Check if we have any AI provider configured
    if (!this.useTimewebAI && !this.openaiApiKey) {
      // Stub mode - return formatted structured outputs
      return this.generateStubResponse(structuredOutputs);
    }

    // Real LLM integration
    try {
      if (this.useTimewebAI) {
        return await this.callTimewebAI(userMessage, structuredOutputs, financeContext);
      } else if (this.openaiApiKey) {
        return await this.callOpenAI(userMessage, structuredOutputs, financeContext);
      }
      return this.generateStubResponse(structuredOutputs);
    } catch (error) {
      this.logger.error(`LLM error: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to stub
      return this.generateStubResponse(structuredOutputs);
    }
  }

  private async callTimewebAI(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    // Формируем детальный контекст о транзакциях
    const recentTransactionsText = financeContext.recentTransactions
      .slice(0, 15)
      .map((t: any) => {
        const date = new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        const type = t.type === 'INCOME' ? 'Доход' : 'Расход';
        const note = t.note ? ` (${t.note})` : '';
        return `${date}: ${type} ${t.amount.toLocaleString('ru-RU')} ₽ - ${t.category}${note}`;
      })
      .join('\n');

    const systemPrompt = `
Вы — Runa AI, интеллектуальный финансовый помощник в приложении RUNA Finance.
Ваша задача: анализировать финансы пользователя и давать персональные рекомендации на основе его реальных данных.

ПОВЕДЕНИЕ:
- Отвечайте дружелюбно, но профессионально на русском языке
- Используйте конкретные цифры из данных пользователя
- Давайте практические советы по управлению финансами
- Если видите проблемы (перерасход, долги), мягко указывайте на них
- Предлагайте конкретные действия для улучшения финансовой ситуации

ДЕТАЛЬНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ:

📊 ТЕКУЩИЙ МЕСЯЦ:
- Доходы: ${financeContext.currentMonth.income.toLocaleString('ru-RU')} ₽
- Расходы: ${financeContext.currentMonth.expense.toLocaleString('ru-RU')} ₽
- Остаток: ${financeContext.currentMonth.net.toLocaleString('ru-RU')} ₽
- Норма сбережений: ${financeContext.savingsRate ? financeContext.savingsRate.toFixed(1) : '0'}%

💰 ТОП КАТЕГОРИЙ РАСХОДОВ:
${financeContext.topExpenseCategories.length > 0 
  ? financeContext.topExpenseCategories.map((c: any, idx: number) => 
      `${idx + 1}. ${c.category}: ${c.amount.toLocaleString('ru-RU')} ₽`
    ).join('\n')
  : 'Нет данных о расходах'}

💵 ТОП КАТЕГОРИЙ ДОХОДОВ:
${financeContext.topIncomeCategories.length > 0
  ? financeContext.topIncomeCategories.map((c: any, idx: number) =>
      `${idx + 1}. ${c.category}: ${c.amount.toLocaleString('ru-RU')} ₽`
    ).join('\n')
  : 'Нет данных о доходах'}

📝 ПОСЛЕДНИЕ ТРАНЗАКЦИИ (15 последних):
${recentTransactionsText || 'Нет транзакций'}

🎯 АКТИВНЫЕ ЦЕЛИ:
${financeContext.goals.length > 0
  ? financeContext.goals.map((g: any) => {
      const deadlineText = g.deadline ? ` (до ${new Date(g.deadline).toLocaleDateString('ru-RU')})` : '';
      return `- ${g.name}: ${g.currentAmount.toLocaleString('ru-RU')} ₽ / ${g.targetAmount.toLocaleString('ru-RU')} ₽ (${Math.round(g.progressPercent)}%)${deadlineText}`;
    }).join('\n')
  : 'Нет активных целей'}

💳 КРЕДИТЫ И ДОЛГИ:
${financeContext.creditAccounts.length > 0
  ? financeContext.creditAccounts.map((ca: any) => {
      const limitAmount = ca.creditLimit ? ca.creditLimit.toLocaleString('ru-RU') : '';
      const limitText = ca.creditLimit ? ` (лимит ${limitAmount} ₽)` : '';
      const paymentDate = ca.nextPaymentDate ? new Date(ca.nextPaymentDate).toLocaleDateString('ru-RU') : '';
      const paymentText = ca.nextPaymentDate ? ` (платеж ${paymentDate})` : '';
      return `- ${ca.name}: долг ${ca.currentDebt.toLocaleString('ru-RU')} ₽${limitText}${paymentText}`;
    }).join('\n')
  : 'Нет кредитов'}

📈 ИНВЕСТИЦИОННЫЙ ПОРТФЕЛЬ:
- Активов: ${financeContext.portfolio.assetCount}
- Общая стоимость: ${financeContext.portfolio.totalCost.toLocaleString('ru-RU')} ₽

🔍 АНАЛИТИКА И РЕКОМЕНДАЦИИ ОТ СИСТЕМЫ:
${structuredOutputs.length > 0
  ? structuredOutputs.map((o: any) => `- ${o.payload.title}: ${o.payload.description}${o.payload.suggestions ? '\n  Рекомендации: ' + o.payload.suggestions.join(', ') : ''}`).join('\n')
  : 'Нет специальных рекомендаций'}

ИНСТРУКЦИИ:
- Если пользователь просит показать график/диаграмму, добавьте в ответ: [CHART_REQUEST: {"type": "DONUT", "title": "Анализ бюджета"}]
- Всегда используйте реальные данные пользователя для расчетов
- Будьте конкретны: называйте суммы, категории, даты
- Предлагайте действия, которые пользователь может выполнить прямо сейчас
`.trim();

    try {
      // Timeweb Cloud AI использует OpenAI-совместимый API
      const response = await fetch(this.timewebApiUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Timeweb Cloud AI использует стандартные модели
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        let errData;
        try {
          errData = JSON.parse(errText);
        } catch {
          errData = { message: errText };
        }
        throw new Error(`Timeweb AI API error: ${JSON.stringify(errData)}`);
      }

      const data: any = await response.json();
      const text = data.choices[0]?.message?.content || 'Извините, я не смог сформулировать ответ.';

      return {
        text,
        tokensUsed: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
        model: 'timeweb-cloud-ai',
      };
    } catch (error) {
      this.logger.error(`Timeweb AI call failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async callOpenAI(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    const systemPrompt = `
Вы — Runa AI, интеллектуальный финансовый помощник в приложении RUNA.
Ваша задача: лаконично анализировать финансы пользователя в контексте РФ (рубли, категории трат, цели).

ПОВЕДЕНИЕ:
- При начале сложного анализа обязательно пишите: "Анализирую ваши доходы и расходы..." или "Провожу анализ ваших затрат...".
- Отвечайте максимально просто и коротко. Экономьте токены.
- Только финансовая аналитика и планирование. Никаких общих тем.
- Вы не даете юридических советов, но можете мягко рекомендовать инструменты дохода или накопления.
- Используйте данные пользователя для точных расчетов.

ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (Context):
- Месяц: Доходы ${financeContext.currentMonth.income} ₽, Расходы ${financeContext.currentMonth.expense} ₽, Остаток ${financeContext.currentMonth.net} ₽.
- Топ расходов: ${financeContext.topExpenseCategories.map((c: any) => `${c.category} (${c.amount} ₽)`).join(', ')}.
- Цели: ${financeContext.goals.map((g: any) => `${g.name} (${Math.round(g.progressPercent)}%)`).join(', ') || 'Нет активных целей'}.
- Кредиты: ${financeContext.creditAccounts.map((ca: any) => `${ca.name} (долг ${ca.currentDebt} ₽)`).join(', ') || 'Нет долгов'}.

ИНСАЙТЫ ОТ СИСТЕМЫ ПРАВИЛ:
${structuredOutputs.map(o => `- ${o.payload.title}: ${o.payload.description}`).join('\n')}

ИНСТРУКЦИЯ ПО ФОРМАТУ:
Если пользователь спрашивает про график/диаграмму расходов, обязательно добавьте в ответ:
[CHART_REQUEST: { "type": "DONUT", "title": "Анализ бюджета" }]

Отвечайте на русском языке.
`.trim();

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: this.openaiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(errData)}`);
      }

      const data: any = await response.json();
      const text = data.choices[0]?.message?.content || 'Извините, я не смог сформулировать ответ.';

      return {
        text,
        tokensUsed: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
        model: this.openaiModel,
      };
    } catch (error) {
      this.logger.error(`OpenAI call failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private generateStubResponse(structuredOutputs: AIStructuredOutput[]): LLMResponse {
    const parts: string[] = [];

    for (const output of structuredOutputs) {
      if (output.type === 'warning' || output.type === 'insight') {
        parts.push(`📊 ${output.payload.title}`);
        if (output.payload.description) {
          parts.push(output.payload.description);
        }
        if (output.payload.suggestions && output.payload.suggestions.length > 0) {
          parts.push('\n💡 Рекомендации:');
          output.payload.suggestions.forEach((s) => parts.push(`• ${s}`));
        }
      } else if (output.type === 'plan') {
        parts.push(`📈 ${output.payload.title}`);
        if (output.payload.description) {
          parts.push(output.payload.description);
        }
      }
    }

    return {
      text: parts.join('\n\n') || 'Анализ ваших финансов показывает стабильную ситуацию.',
      tokensUsed: { input: 0, output: 0 },
      model: 'stub',
    };
  }

  /**
   * Safety guardrails: Check if user message contains risky requests
   */
  validateUserMessage(message: string): { safe: boolean; reason?: string } {
    const lowerMessage = message.toLowerCase();

    // Block direct investment advice requests
    const riskyPatterns = [
      /купи.*акци/i,
      /продай.*акци/i,
      /инвестируй.*в/i,
      /гарантированн/i,
      /100%.*прибыл/i,
    ];

    for (const pattern of riskyPatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          safe: false,
          reason: 'Я не могу давать конкретные инвестиционные рекомендации. Пожалуйста, проконсультируйтесь с финансовым советником.',
        };
      }
    }

    return { safe: true };
  }
}
