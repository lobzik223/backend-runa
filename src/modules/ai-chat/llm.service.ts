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

/** Хвост диалога для chat completions (после system). */
export type LlmConversationTurn = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  /** Поддерживаем GROK_API_KEY и XAI_API_KEY (как в curl от xAI) */
  private readonly grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  private readonly grokModel = process.env.GROK_MODEL || 'grok-4-1-fast-reasoning';
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly openaiModel = process.env.OPENAI_MODEL || 'gpt-5-nano';
  /** Таймаут HTTP к Grok/OpenAI (мс). Долгие ответы без лимита дают обрыв на nginx/телефоне. */
  private readonly llmFetchTimeoutMs = Math.max(15000, Number(process.env.LLM_FETCH_TIMEOUT_MS) || 120000);
  /** Максимум токенов в ответе (Grok/OpenAI). */
  private readonly maxOutputTokens = Math.min(
    8192,
    Math.max(256, Number(process.env.LLM_MAX_OUTPUT_TOKENS) || 2048),
  );
  /** Креативность формулировок (0–2). Выше — разнообразнее ответы. */
  private readonly temperature = Math.min(
    1.5,
    Math.max(0.2, Number(process.env.LLM_TEMPERATURE) || 0.82),
  );

  constructor() {
    this.logger.log(
      `[LLM Service] Grok API key: ${this.grokApiKey ? 'SET' : 'NOT SET'}, model: ${this.grokModel}, max_out=${this.maxOutputTokens}, temp=${this.temperature}`,
    );
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
    conversationHistory: LlmConversationTurn[] = [],
  ): Promise<LLMResponse> {
    const responseLanguage = preferredLanguage ?? this.detectResponseLanguage(userMessage);
    const turns =
      conversationHistory.length > 0
        ? conversationHistory
        : [{ role: 'user' as const, content: userMessage }];
    this.logger.log(
      `[LLM] responseLanguage=${responseLanguage} (preferred=${preferredLanguage ?? 'auto'}), historyTurns=${turns.length}`,
    );

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
        return await this.callGrok(
          structuredOutputs,
          financeContext,
          webSearchResults,
          responseLanguage,
          turns,
        );
      }
      if (useOpenAI) {
        this.logger.log('[LLM] Using OpenAI');
        return await this.callOpenAI(
          structuredOutputs,
          financeContext,
          webSearchResults,
          responseLanguage,
          turns,
        );
      }
      return this.generateStubResponse(structuredOutputs);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isAbort =
        (error instanceof Error && error.name === 'AbortError') ||
        errMsg.includes('aborted') ||
        errMsg.includes('AbortError');
      if (isAbort) {
        this.logger.error(
          `[LLM] Grok/OpenAI: таймаут или обрыв (${this.llmFetchTimeoutMs} ms). Увеличьте LLM_FETCH_TIMEOUT_MS или проверьте сеть/xAI.`,
        );
      } else {
        this.logger.error(`[LLM] Grok/OpenAI error: ${errMsg}`);
      }
      this.logger.warn('[LLM] Falling back to stub mode. Проверьте GROK_API_KEY / OPENAI_API_KEY и логи выше.');
      return this.generateStubResponse(structuredOutputs);
    }
  }

  private buildSystemPrompt(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
  ): string {
    const ctx = financeContext ?? {};
    const recentTransactions = Array.isArray(ctx.recentTransactions) ? ctx.recentTransactions : [];
    const currentMonth = ctx.currentMonth ?? { income: 0, expense: 0, net: 0 };
    const topExpenseCategories = Array.isArray(ctx.topExpenseCategories) ? ctx.topExpenseCategories : [];
    const topIncomeCategories = Array.isArray(ctx.topIncomeCategories) ? ctx.topIncomeCategories : [];
    const goals = Array.isArray(ctx.goals) ? ctx.goals : [];
    const creditAccounts = Array.isArray(ctx.creditAccounts) ? ctx.creditAccounts : [];
    const portfolio = ctx.portfolio ?? { totalCost: 0, assetCount: 0 };
    const exchangeRates = ctx.exchangeRates ?? null;

    const recentTransactionsText = recentTransactions
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

Для любых фактуальных вопросов (курсы, даты, цифры, события) опирайся ТОЛЬКО на этот блок и на данные пользователя ниже. Если в поиске нет ответа — честно скажи, что актуальных данных нет, и порекомендуй источник (например cbr.ru, ЦБ РФ). Перед ответом мысленно сверь факты с этими сниппетами.`
        : `
🌐 ПОИСК В ИНТЕРНЕТЕ: в этом запросе сниппеты поиска не подставлялись (на сервере может быть не задан SERPER_API_KEY). Для ставок ЦБ, курсов, новостей банков и точных условий продуктов называй только данные из блока курсов ЦБ ниже и из приложения пользователя; для остального предлагай проверить официальный сайт банка или cbr.ru и не выдумывай цифры.`;

    return `
Вы — RUNA, персональный финансовый ассистент в приложении RUNA Finance. Сегодняшняя дата: ${new Date().toLocaleDateString('ru-RU')}, 2026 год.
${searchBlock}

МИССИЯ:
Помогать пользователю (целевая аудитория 18–30 лет) экономить деньги каждый день, развивать финансовую дисциплину и превращать финансовые действия в привычку с видимым результатом.

КОМПЕТЕНЦИЯ (отвечай развёрнуто и по существу):
- Банкинг и платежи: счета, карты (дебет/кредит), переводы, СБП, комиссии, лимиты, безопасность платежей.
- Кредиты и займы: ипотека, потребительские кредиты, рефинансирование, график платежей, досрочное погашение (общие принципы, без обещаний).
- Накопления: вклады, накопительные счета, подушка безопасности, цели — в связке с данными пользователя в приложении.
- Регуляторика и ориентиры: ЦБ РФ, страхование вкладов (общие сведения), официальные источники для фактов.
- Налоги и учёт личных финансов — в бытовом, понятном виде (не замена бухгалтеру/юристу).
Если вопрос про банки/продукты/ставки — опирайся на блок поиска и официальные источники; не выдумывай ставки и условия.

РАЗНООБРАЗИЕ И СТИЛЬ ДИАЛОГА:
- Не повторяй одни и те же шаблонные фразы из ответа в ответ. Меняй структуру: то короткий ответ с буллетами, то связный абзац, то шаги 1–2–3.
- Уточняй, если не хватает данных; предлагай гипотезы с оговоркой «если…».
- Проявляй «живое» мышление: сравнения, оговорки по рискам, альтернативы — без канцелярита и без одного и того же вступления каждый раз.

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
Чёткий, спокойный, рациональный, современный, финансово грамотный. Без давления и обещаний. Персонализированный под привычки пользователя. Превращай финансовые действия в ежедневную привычку с видимым результатом. Избегай однообразных вступлений вроде «Конечно, помогу» в каждом сообщении.

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
- Доходы: ${Number(currentMonth.income).toLocaleString('ru-RU')} ₽
- Расходы: ${Number(currentMonth.expense).toLocaleString('ru-RU')} ₽
- Остаток: ${Number(currentMonth.net).toLocaleString('ru-RU')} ₽
- Норма сбережений: ${ctx.savingsRate != null ? Number(ctx.savingsRate).toFixed(1) : '0'}%

💰 ТОП КАТЕГОРИЙ РАСХОДОВ:
${topExpenseCategories.length > 0
  ? topExpenseCategories.map((c: any, idx: number) =>
      `${idx + 1}. ${c.category}: ${Number(c.amount).toLocaleString('ru-RU')} ₽`
    ).join('\n')
  : 'Нет данных о расходах'}

💵 ТОП КАТЕГОРИЙ ДОХОДОВ:
${topIncomeCategories.length > 0
  ? topIncomeCategories.map((c: any, idx: number) =>
      `${idx + 1}. ${c.category}: ${Number(c.amount).toLocaleString('ru-RU')} ₽`
    ).join('\n')
  : 'Нет данных о доходах'}

📝 ПОСЛЕДНИЕ ТРАНЗАКЦИИ (15 последних):
${recentTransactionsText || 'Нет транзакций'}

🎯 АКТИВНЫЕ ЦЕЛИ:
${goals.length > 0
  ? goals.map((g: any) => {
      const deadlineText = g.deadline ? ` (до ${new Date(g.deadline).toLocaleDateString('ru-RU')})` : '';
      return `- ${g.name}: ${Number(g.currentAmount).toLocaleString('ru-RU')} ₽ / ${Number(g.targetAmount).toLocaleString('ru-RU')} ₽ (${Math.round(Number(g.progressPercent) || 0)}%)${deadlineText}`;
    }).join('\n')
  : 'Нет активных целей'}

💳 КРЕДИТЫ И ДОЛГИ:
${creditAccounts.length > 0
  ? creditAccounts.map((ca: any) => {
      const limitAmount = ca.creditLimit != null ? Number(ca.creditLimit).toLocaleString('ru-RU') : '';
      const limitText = ca.creditLimit != null ? ` (лимит ${limitAmount} ₽)` : '';
      const paymentDate = ca.nextPaymentDate ? new Date(ca.nextPaymentDate).toLocaleDateString('ru-RU') : '';
      const paymentText = ca.nextPaymentDate ? ` (платеж ${paymentDate})` : '';
      return `- ${ca.name}: долг ${Number(ca.currentDebt).toLocaleString('ru-RU')} ₽${limitText}${paymentText}`;
    }).join('\n')
  : 'Нет кредитов'}

📈 ИНВЕСТИЦИОННЫЙ ПОРТФЕЛЬ:
- Активов: ${Number(portfolio.assetCount) || 0}
- Общая стоимость: ${Number(portfolio.totalCost).toLocaleString('ru-RU')} ₽

💱 АКТУАЛЬНЫЕ КУРСЫ ЦБ РФ (обязательно используй ТОЛЬКО эти цифры для вопросов о валюте):
${exchangeRates
  ? `- Дата курсов: ${exchangeRates.date}
- 1 USD = ${Number(exchangeRates.usd).toLocaleString('ru-RU')} ₽
- 1 EUR = ${Number(exchangeRates.eur).toLocaleString('ru-RU')} ₽
Для любых вопросов про курс рубля к доллару или евро отвечай ТОЛЬКО этими значениями и всегда указывай дату (${exchangeRates.date}). Не используй свои старые знания о курсах.`
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
${responseLanguage === 'en' ? '\nLANGUAGE: Answer ONLY in English. Cover banking, payments, credit, savings, and personal finance with the same rigor; vary phrasing and structure each time.' : '\nЯЗЫК ОТВЕТА: Отвечай ТОЛЬКО на русском языке. Весь твой ответ должен быть на русском.'}
`.trim();
  }

  private async callGrok(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
    conversationTurns: LlmConversationTurn[] = [],
  ): Promise<LLMResponse> {
    if (!this.grokApiKey) {
      throw new Error('Grok не настроен: задайте GROK_API_KEY или XAI_API_KEY в .env');
    }

    const systemPrompt = this.buildSystemPrompt(structuredOutputs, financeContext, webSearchResults, responseLanguage);

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationTurns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const requestBody = {
      model: this.grokModel,
      messages: chatMessages,
      temperature: this.temperature,
      max_tokens: this.maxOutputTokens,
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
      signal: AbortSignal.timeout(this.llmFetchTimeoutMs),
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

    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      this.logger.error('[Grok] Invalid JSON in response');
      throw new Error('Grok API returned invalid JSON');
    }
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
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    responseLanguage: 'ru' | 'en' = 'ru',
    conversationTurns: LlmConversationTurn[] = [],
  ): Promise<LLMResponse> {
    const systemPrompt = this.buildSystemPrompt(structuredOutputs, financeContext, webSearchResults, responseLanguage);

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationTurns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.openaiModel,
        messages: chatMessages,
        temperature: this.temperature,
        max_tokens: this.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(this.llmFetchTimeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errData: any;
      try {
        errData = JSON.parse(errText);
      } catch {
        errData = { message: errText || response.statusText };
      }
      this.logger.error(`[OpenAI] API error (${response.status}): ${JSON.stringify(errData)}`);
      throw new Error(`OpenAI API error: ${JSON.stringify(errData)}`);
    }

    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      this.logger.error('[OpenAI] Invalid JSON in response');
      throw new Error('OpenAI API returned invalid JSON');
    }
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

    const fallback =
      'Я RUNA: банкинг, бюджет, кредиты и цели — задайте вопрос конкретнее. Сейчас ответ без нейросети (проверьте GROK_API_KEY на сервере).';
    return {
      text: parts.join('\n\n') || fallback,
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
