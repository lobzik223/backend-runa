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

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  /** Поддерживаем GROK_API_KEY и XAI_API_KEY (как в curl от xAI) */
  private readonly grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  private readonly grokModel = process.env.GROK_MODEL || 'grok-4-1-fast-reasoning';
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly openaiModel = process.env.OPENAI_MODEL || 'gpt-5-nano';

  constructor() {
    this.logger.log(`[LLM Service] Grok API key: ${this.grokApiKey ? 'SET' : 'NOT SET'}, model: ${this.grokModel}`);
    this.logger.log(`[LLM Service] OPENAI_API_KEY: ${this.openaiApiKey ? 'SET' : 'NOT SET'}`);
    if (this.grokApiKey) {
      this.logger.log(`[LLM Service] ✅ Grok (xAI) настроен — общение, анализ, тактики по финансам`);
    } else if (this.openaiApiKey) {
      this.logger.log(`[LLM Service] ✅ OpenAI настроен (fallback)`);
    } else {
      this.logger.warn(`[LLM Service] ⚠️ AI не настроен: задайте GROK_API_KEY или XAI_API_KEY в .env. Будет использован stub.`);
    }
  }

  /**
   * Convert structured outputs to natural language
   */
  async generateResponse(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    const useGrok = !!this.grokApiKey;
    const useOpenAI = !!this.openaiApiKey;
    this.logger.log(`[LLM] useGrok=${useGrok}, useOpenAI=${useOpenAI}`);

    if (!useGrok && !useOpenAI) {
      this.logger.warn('[LLM] No AI provider configured, using stub mode');
      return this.generateStubResponse(structuredOutputs);
    }

    try {
      if (useGrok) {
        this.logger.log('[LLM] Using Grok (xAI)');
        return await this.callGrok(userMessage, structuredOutputs, financeContext);
      }
      if (useOpenAI) {
        this.logger.log('[LLM] Using OpenAI');
        return await this.callOpenAI(userMessage, structuredOutputs, financeContext);
      }
      return this.generateStubResponse(structuredOutputs);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[LLM] Grok/OpenAI error: ${errMsg}`);
      this.logger.warn('[LLM] Falling back to stub mode. Проверьте GROK_API_KEY на сервере и логи выше.');
      return this.generateStubResponse(structuredOutputs);
    }
  }

  private buildSystemPrompt(structuredOutputs: AIStructuredOutput[], financeContext: any): string {
    const recentTransactionsText = financeContext.recentTransactions
      .slice(0, 15)
      .map((t: any) => {
        const date = new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        const type = t.type === 'INCOME' ? 'Доход' : 'Расход';
        const note = t.note ? ` (${t.note})` : '';
        return `${date}: ${type} ${t.amount.toLocaleString('ru-RU')} ₽ - ${t.category}${note}`;
      })
      .join('\n');

    return `
Вы — Runa AI, интеллектуальный финансовый помощник в приложении RUNA Finance. Сегодняшняя дата: ${new Date().toLocaleDateString('ru-RU')}, 2026 год.

ВАШИ ВОЗМОЖНОСТИ:
- Общаться с пользователем на русском: отвечать на вопросы, уточнять, поддерживать диалог
- Анализировать состояние в приложении: доходы, расходы, цели, кредиты, портфель — по реальным данным ниже
- Генерировать тактики по финансам: как копить, куда сократить траты, как достичь целей, как гасить долги
- Помогать с планированием бюджета, нормой сбережений, предупреждать о рисках и давать конкретные шаги

ПОВЕДЕНИЕ:
- Всегда учитывайте, что сейчас 2026 год. Используйте актуальные даты для планирования и анализа.
- Отвечайте дружелюбно, но по делу, на русском языке
- Опирайтесь на цифры из данных пользователя — называйте суммы, категории, даты
- Давайте практические советы и пошаговые тактики
- При проблемах (перерасход, долги, недостижимые цели) мягко указывайте и предлагайте действия
- Предлагайте действия, которые пользователь может выполнить прямо сейчас
- ВАЖНО: Не используйте Markdown-разметку типа жирного текста (**текст**) или заголовков (#). Пишите чистым текстом, разделяя логические блоки пустыми строками. Делайте списки через обычный дефис (-). Ответ должен быть чистым, понятным и удобным для чтения без спецсимволов.
- Интерпретируйте данные красиво и понятно, чтобы пользователю было удобно делать расчеты.
- При анализе прошлых периодов и прогнозировании будущего всегда опирайтесь на текущий 2026 год.

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
- ПИШИТЕ БЕЗ ИСПОЛЬЗОВАНИЯ ** (ДВОЙНЫХ ЗВЕЗДОЧЕК).
`.trim();
  }

  private async callGrok(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    if (!this.grokApiKey) {
      throw new Error('Grok не настроен: задайте GROK_API_KEY или XAI_API_KEY в .env');
    }

    const systemPrompt = this.buildSystemPrompt(structuredOutputs, financeContext);

    const requestBody = {
      model: this.grokModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 800,
      stream: false,
    };

    this.logger.log(`[Grok] Calling ${GROK_API_URL}, model=${this.grokModel}, prompt_length=${systemPrompt.length}`);

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.grokApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    this.logger.log(`[Grok] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errText = await response.text();
      let errData: any;
      try {
        errData = JSON.parse(errText);
      } catch {
        errData = { message: errText };
      }
      this.logger.error(`[Grok] API error (${response.status}): ${JSON.stringify(errData)}`);
      if (response.status === 401 || response.status === 403) {
        this.logger.error(`[Grok] ❌ Неверный API ключ. Получите ключ: https://console.x.ai/team/default/api-keys`);
      }
      throw new Error(`Grok API error: ${JSON.stringify(errData)}`);
    }

    const data: any = await response.json();
    const text = data.choices?.[0]?.message?.content || 'Извините, я не смог сформулировать ответ.';

    this.logger.log(`[Grok] Success! Response length: ${text.length}, tokens: ${data.usage?.total_tokens ?? 0}`);

    return {
      text,
      tokensUsed: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
      model: this.grokModel,
    };
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
