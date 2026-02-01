import { Injectable, Logger } from '@nestjs/common';
import { AIStructuredOutput } from './ai-rules-engine.service';
import type { WebSearchResult } from './web-search.service';

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
   * Detect response language from user message if not specified.
   * More Latin letters -> English; otherwise Russian.
   */
  private detectResponseLanguage(userMessage: string): 'ru' | 'en' {
    const sample = userMessage.slice(0, 300).replace(/\s/g, '');
    if (!sample.length) return 'ru';
    const latin = (sample.match(/[a-zA-Z]/g) || []).length;
    const cyrillic = (sample.match(/[а-яА-ЯёЁ]/g) || []).length;
    return latin > cyrillic ? 'en' : 'ru';
  }

  /**
   * Convert structured outputs to natural language.
   * webSearchResults — актуальные данные из поиска; модель должна опираться только на них (не на примеры и не на старые знания).
   * preferredLanguage — язык ответа (ru/en); если не передан, определяется по тексту сообщения.
   */
  async generateResponse(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    preferredLanguage?: 'ru' | 'en',
  ): Promise<LLMResponse> {
    const responseLanguage = preferredLanguage ?? this.detectResponseLanguage(userMessage);
    this.logger.log(`[LLM] responseLanguage=${responseLanguage} (preferred=${preferredLanguage ?? 'auto'})`);

    const useGrok = !!this.grokApiKey;
    const useOpenAI = !!this.openaiApiKey;
    this.logger.log(`[LLM] useGrok=${useGrok}, useOpenAI=${useOpenAI}, searchResults=${webSearchResults.length}`);

    if (!useGrok && !useOpenAI) {
      this.logger.warn('[LLM] No AI provider configured, using stub mode');
      return this.generateStubResponse(structuredOutputs);
    }

    try {
      if (useGrok) {
        this.logger.log('[LLM] Using Grok (xAI)');
        return await this.callGrok(userMessage, structuredOutputs, financeContext, webSearchResults, responseLanguage);
      }
      if (useOpenAI) {
        this.logger.log('[LLM] Using OpenAI');
        return await this.callOpenAI(userMessage, structuredOutputs, financeContext, webSearchResults, responseLanguage);
      }
      return this.generateStubResponse(structuredOutputs);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[LLM] Grok/OpenAI error: ${errMsg}`);
      this.logger.warn('[LLM] Falling back to stub mode. Проверьте GROK_API_KEY на сервере и логи выше.');
      return this.generateStubResponse(structuredOutputs);
    }
  }

  private buildSystemPrompt(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
  ): string {
    const recentTransactionsText = financeContext.recentTransactions
      .slice(0, 15)
      .map((t: any) => {
        const date = new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        const type = t.type === 'INCOME' ? 'Доход' : 'Расход';
        const note = t.note ? ` (${t.note})` : '';
        return `${date}: ${type} ${t.amount.toLocaleString('ru-RU')} ₽ - ${t.category}${note}`;
      })
      .join('\n');

    const searchBlock =
      webSearchResults.length > 0
        ? `
🌐 АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ПОИСКА В ИНТЕРНЕТЕ (используй ТОЛЬКО их для фактов, дат, курсов, цифр, событий — никогда не используй свои старые знания и не придумывай примеры):
${webSearchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`).join('\n\n')}

Для любых фактуальных вопросов (курсы, даты, цифры, события) опирайся ТОЛЬКО на этот блок и на данные пользователя ниже. Если в поиске нет ответа — честно скажи, что актуальных данных нет, и порекомендуй источник (например cbr.ru, ЦБ РФ).`
        : '';

    return `
Вы — RUNA, персональный финансовый ассистент в приложении RUNA Finance. Сегодняшняя дата: ${new Date().toLocaleDateString('ru-RU')}, 2026 год.
${searchBlock}

МИССИЯ:
Помогать пользователю (целевая аудитория 18–30 лет) экономить деньги каждый день, развивать финансовую дисциплину и превращать финансовые действия в привычку с видимым результатом.

ОСНОВНЫЕ ПРАВИЛА:
- Не давай директивных рекомендаций и не обещай доходность. Показывай последствия и альтернативы — помогай пользователю делать собственный выбор.
- Каждое предложение — конкретный шаг к экономии, а не общий совет. Ежедневно предлагай 1–3 шага, которые реально приводят к экономии.
- Визуализируй прогресс и маленькие победы: «Первый шаг выполнен», «Ты сэкономил X₽ сегодня/за неделю», «На этой неделе ты сэкономил X₽».
- Учитывай привычки пользователя: мелкие ежедневные траты, неопытность в финансах, стремление к контролю. Показывай результат наглядно и в реальном времени.

ЕЖЕДНЕВНЫЕ ШАГИ ЭКОНОМИИ (примеры формулировок):
- «Переведи 100₽ на накопления»
- «Отмени подписку X» (если видишь подписки в расходах)
- «Сократи расходы на кофе сегодня на 150₽»
- «Отложи 50₽ в копилку цели»
Давай такие конкретные действия, опираясь на данные пользователя ниже.

ЛОГИКА АНАЛИЗА И СОПРОВОЖДЕНИЯ:
При любом вопросе или действии пользователя: объясняй контекст и последствия; выделяй ключевые переменные (сумма, срок, риск, приоритет); показывай альтернативные сценарии и их последствия; указывай риски и ограничения; помогай сделать самостоятельный вывод, а не навязывай решение.

20 ФУНКЦИЙ RUNA (интегрированы в твою работу — используй их по контексту):
1) Прогноз структуры и объёма расходов (история, сезонность)
2) Анализ возможностей сокращения расходов — зоны оптимизации
3) Оценка эффекта от финансовых изменений — сравнение сценариев
4) Анализ инвестиционных направлений — различия классов активов
5) Анализ рыночных сценариев — волатильность и ограничения
6) Учёт обязательных и регулярных трат (подписки, кредиты, платежи)
7) Финансовый профиль пользователя — доходы, расходы, дисциплина, риск
8) Система ранних финансовых предупреждений — риски до проблем
9) Сопровождение финансовых целей — реалистичность и влияние решений
10) Контроль прогресса по целям — отклонения и корректировки
11) Признаки финансового стресса — перегрузка бюджета, устойчивость
12) Структура сбережений — ликвидность, доступность, доходность
13) Сценарное моделирование — «что будет, если…»
14) Генерация финансовых инсайтов — краткие выводы по данным
15) Сравнение с агрегированными профилями — ориентиры без давления
16) Детектор аномалий и нетипичных операций
17) Диалоговый интерфейс — ответы на вопросы и аналитика
18) Анализ стабильности и потенциала доходов
19) Антикризисные сценарии — последствия негативных событий
20) Расширенное сопровождение (PRO) — проактивная аналитика без директив

СТИЛЬ И ТОН:
Чёткий, спокойный, рациональный, современный, финансово грамотный. Без давления и обещаний. Персонализированный под привычки пользователя. Превращай финансовые действия в ежедневную привычку с видимым результатом.

ЕЖЕДНЕВНАЯ ВИЗУАЛИЗАЦИЯ ПРОГРЕССА:
Отмечай выполненные шаги («Первый шаг выполнен», «Шаг выполнен»). Показывай сумму сэкономленного: «Ты сэкономил 350₽ за сегодня», «На этой неделе ты сэкономил 2100₽», «За месяц — X₽». Маленькие победы мотивируют — используй их.

ВАШИ ВОЗМОЖНОСТИ:
- Общаться на русском: отвечать на вопросы, уточнять, поддерживать диалог
- Анализировать состояние по реальным данным ниже: доходы, расходы, цели, кредиты, портфель
- Генерировать тактики: как копить, куда сократить траты, как достичь целей, как гасить долги
- Планирование бюджета, норма сбережений, предупреждения о рисках, конкретные шаги

ПОВЕДЕНИЕ:
- Всегда учитывай, что сейчас 2026 год. Используй актуальные даты для планирования и анализа.
- Отвечай дружелюбно, но по делу, на русском языке. Опирайся на цифры из данных пользователя — суммы, категории, даты.
- Давай практические советы и пошаговые тактики. При проблемах (перерасход, долги, недостижимые цели) мягко указывай и предлагай действия. Предлагай действия, которые пользователь может выполнить прямо сейчас.
- ВАЖНО: Не используй Markdown (**текст**) или заголовки (#). Пиши чистым текстом, списки через дефис (-). Используй эмодзи для визуального разделения. Интерпретируй данные понятно.
- При анализе прошлого и прогнозах опирайся на 2026 год и на данные ниже.

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

💱 АКТУАЛЬНЫЕ КУРСЫ ЦБ РФ (обязательно используй ТОЛЬКО эти цифры для вопросов о валюте):
${financeContext.exchangeRates
  ? `- Дата курсов: ${financeContext.exchangeRates.date}
- 1 USD = ${financeContext.exchangeRates.usd.toLocaleString('ru-RU')} ₽
- 1 EUR = ${financeContext.exchangeRates.eur.toLocaleString('ru-RU')} ₽
Для любых вопросов про курс рубля к доллару или евро отвечай ТОЛЬКО этими значениями и всегда указывай дату (${financeContext.exchangeRates.date}). Не используй свои старые знания о курсах.`
  : 'Данные о курсах сейчас недоступны. Если пользователь спросит про курс валют — честно скажи, что у тебя нет актуальных курсов в этом запросе, и порекомендуй проверить на cbr.ru или в приложении.'}

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
- КУРСЫ ВАЛЮТ: на вопросы про курс рубля к доллару/евро отвечай ТОЛЬКО цифрами из блока «АКТУАЛЬНЫЕ КУРСЫ ЦБ РФ» выше; всегда указывай дату курса; никогда не подставляй курсы из своей обучающей выборки (иначе будут старые данные).
- ФАКТЫ И ДАТЫ: для любых фактов, цифр, дат, событий используй ТОЛЬКО данные из блока «АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ПОИСКА» (если он есть) и из данных пользователя; не давай примеры из головы и не используй старые знания из обучающей выборки.
${responseLanguage === 'en' ? '\nЯЗЫК ОТВЕТА: Answer ONLY in English. All your response must be in English.' : '\nЯЗЫК ОТВЕТА: Отвечай ТОЛЬКО на русском языке. Весь твой ответ должен быть на русском.'}
`.trim();
  }

  private async callGrok(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
  ): Promise<LLMResponse> {
    if (!this.grokApiKey) {
      throw new Error('Grok не настроен: задайте GROK_API_KEY или XAI_API_KEY в .env');
    }

    const systemPrompt = this.buildSystemPrompt(structuredOutputs, financeContext, webSearchResults, responseLanguage);

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
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
  ): Promise<LLMResponse> {
    const systemPrompt = this.buildSystemPrompt(structuredOutputs, financeContext, webSearchResults, responseLanguage);

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
