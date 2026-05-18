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
  /** Vision (анализ изображений) — только через OpenAI Chat Completions (мультимодальный). */
  private readonly openaiVisionModel = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  /** Таймаут HTTP к Grok/OpenAI (мс). Долгие ответы без лимита дают обрыв на nginx/телефоне. */
  private readonly llmFetchTimeoutMs = Math.max(15000, Number(process.env.LLM_FETCH_TIMEOUT_MS) || 120000);
  /** Максимум токенов в ответе (Grok/OpenAI). */
  private readonly maxOutputTokens = Math.min(
    8192,
    Math.max(256, Number(process.env.LLM_MAX_OUTPUT_TOKENS) || 1536),
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
    this.logger.log(
      `[LLM Service] OPENAI_API_KEY: ${this.openaiApiKey ? 'SET' : 'NOT SET'}, vision_model=${this.openaiVisionModel}`,
    );
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
    options?: {
      vision?: { mime: string; base64: string };
      compactOutput?: boolean;
    },
  ): Promise<LLMResponse> {
    const trimmedMsg = (userMessage || '').trim();
    /** Интерфейс клиента для подсказки в промпте (русское приложение по умолчанию) */
    const clientLocalePreference = preferredLanguage === 'en' ? 'en' : 'ru';
    /** Язык ответа: по тексту сообщения пользователя при непустом тексте иначе clientLocalePreference */
    const responseLanguage =
      trimmedMsg.length > 0 ? this.detectResponseLanguage(trimmedMsg) : clientLocalePreference;
    const turns =
      conversationHistory.length > 0
        ? conversationHistory
        : [{ role: 'user' as const, content: userMessage }];
    const vision = options?.vision;
    this.logger.log(
      `[LLM] responseLanguage=${responseLanguage} (preferred=${preferredLanguage ?? 'auto'}), historyTurns=${turns.length}, vision=${!!vision}`,
    );

    if (vision?.base64?.length && vision.mime) {
      if (!this.openaiApiKey) {
        throw new Error(
          'Анализ фотографии недоступен: для vision настройте OPENAI_API_KEY на сервере.',
        );
      }
      const maxCompact =
        Math.min(
          1024,
          Math.max(
            384,
            Number(process.env.AI_CHAT_FREE_VISION_MAX_TOKENS) || 576,
          ),
        );
      const maxOut = options?.compactOutput ? maxCompact : this.maxOutputTokens;
      this.logger.log(`[LLM] Vision branch: compact=${options?.compactOutput}, max_tokens=${maxOut}`);
      return this.callOpenAiVisionChat(
        structuredOutputs,
        financeContext,
        webSearchResults,
        turns,
        vision.mime,
        vision.base64,
        maxOut,
        options?.compactOutput === true,
        clientLocalePreference,
      );
    }

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
          turns,
          clientLocalePreference,
        );
      }
      if (useOpenAI) {
        this.logger.log('[LLM] Using OpenAI');
        return await this.callOpenAI(
          structuredOutputs,
          financeContext,
          webSearchResults,
          turns,
          clientLocalePreference,
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

  /**
   * Единый контракт ответов RUNA AI на английском (все модели стабильно следуют ему);
   * фактический текст ответа пользователю — на языке последнего сообщения (см. LANGUAGE RULE).
   */
  private buildRunaAiInternationalContract(
    isStartOfDialogue: boolean,
    uiPreferredLanguage: 'ru' | 'en',
  ): string {
    const greetPolicy = isStartOfDialogue
      ? `GREETING (only on the first user turn of this server thread; NEVER repeat the same template mid-thread):
If the user already clearly greeted, skip a stock hello and answer.
If they did NOT greet, you MAY open with ONE short line in THEIR language, then go straight to substance.
Russian template (ONLY if your reply is Russian and they did not greet): "Привет, я RUNA AI — чем могу помочь тебе сегодня? 💳" — this is the only routine where a single emoji is OK.`
      : `GREETING: Do not re-open with a stock hello. Continue without duplicate greetings.`;

    return `
══════════════════════════════════════════════════════════════
RUNA AI — RESPONSE CONTRACT (always obey; output language = LANGUAGE RULE below)
══════════════════════════════════════════════════════════════
IDENTITY:
You are RUNA AI: a sharp, honest personal-finance copilot inside Runa Finance. Not a motivational speaker. Ground every claim about the user in USER DATA below (+ search snippets if present).

UI LOCALE HINT: ${uiPreferredLanguage === 'en' ? 'client prefers English when ambiguous' : 'client prefers Russian when ambiguous'}.

LANGUAGE RULE (critical — all languages):
Respond in the SAME natural language as the user's latest message. Cyrillic / Russian app context → Russian unless they clearly write otherwise.
If they write chiefly in English or another language, mirror that language consistently for the whole reply (including disclaimers). Do not blend languages unless the user does.

${greetPolicy}

TOKENS & SHAPE:
Every sentence must earn its tokens. Start with the answer — not with generic acknowledgment.
• Casual / thanks / tiny prompts → 1–3 short sentences; match user brevity roughly.
• Simple data question from USER DATA → direct answer + at most ONE crisp extra insight.
• Large analysis (many tx, long window) → structured sections with CLEAR PLAIN-TEXT HEADINGS (no Markdown #, no **bold** asterisks); strip filler; bullets; round numbers; percentages for ratios when helpful.

FORBIDDEN FILLER (any language, including paraphrases): "Отличный вопрос", "Great question", "Конечно", "Certainly", "Glad to help today", "Я рад помочь" without adding information.

AGE (from PROFILE when present):
Adapt depth and tone subtly: 18–24 basics without condescension; 25–34 career/savings balance; 35–49 family + risk awareness; 50+ preservation/consistency. Never say "because of your age".

BEHAVIORAL HINTS FROM DATA:
Silently notice patterns (recurring debits, spikes, avoidance) but NEVER diagnose the person ("you have impulse issues"). Frame as observations + one optional question ("по пятницам X выше — посмотрим это?").

CONTEXT 2025–2026 (general knowledge):
You may use high-level context on rates, regulation, digital banking trends, BNPL, etc. For exact today numbers: prefer SEARCH SNIPPETS block; for RUB crosses (USD/EUR↔RUB) use ONLY the CBR block injected below — never hallucinate rates.

STOCKS / CRYPTO / MACRO (education + framing only):
Explain sectors, correlations, regime changes in plain words. NEVER "buy/sell ticker X". When discussing instruments or news impact, end with a disclaimer in the user's language (RU: «Это не инвестиционный совет», EN: "This is not investment advice.").
If mapping news → market moves, you may use: short horizon, medium horizon, likely assets, CONFIDENCE: LOW|MEDIUM|HIGH + same disclaimer.

"PERSONAL HEALTH CHECK" STYLE (when asked how they are doing with money):
Income line from USER DATA; top ~5 expense buckets with % of income if meaningful; savings vs last month vs 3-mo if data allows; ONE risk; ONE quick win. Bullets preferred.

RECURRING / ANOMALY / BENCHMARKS:
Flag forgotten-style recurring charges gently. Flag one-off large "Прочее" with a single clarifying ask. 50/30/20 etc. only as rules of thumb — label as such.

CUT-COST SCENARIO (only if user asks and USER DATA supports it):
Title + quick / medium / structural steps with ₽ delta tied to real categories; skip micro-categories under ~2% of spend unless user insists.

SINGLE CLARIFYING QUESTION:
At most ONE when you truly cannot answer; not a checklist.

TRUTH & PRIVACY:
Never invent transactions. If missing data, say what is missing. Describe as "по твоим операциям в этом периоде в приложении" — do not claim long-term memory storage.
══════════════════════════════════════════════════════════════
`.trim();
  }

  private buildSystemPrompt(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    clientLocalePreference: 'ru' | 'en' = 'ru',
    conversationTurns: LlmConversationTurn[] = [],
  ): string {
    const userTurns = conversationTurns.filter((t) => t.role === 'user').length;
    const isStartOfDialogue = userTurns <= 1;

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

    const profile = ctx.userProfile as
      | { displayName?: string; profileAge?: number | null; financePurpose?: string | null }
      | undefined;
    const profileBlock =
      profile != null
        ? `
ПРОФИЛЬ (указано пользователем при регистрации / в настройках; используй для контекста и тона, без назойливых отсылок «я вижу твой возраст»):
- Имя в приложении: ${(profile.displayName || 'не указано').trim()}
- Возраст (лет): ${profile.profileAge != null ? String(profile.profileAge) : 'не указан'}
- Заявленная цель / чем занимается в приложении: ${profile.financePurpose?.trim() ? profile.financePurpose.trim() : 'не указано'}
`
        : '';

    return `
Ты — RUNA: честный, максимально полезный финансовый помощник в приложении Runa Finance. Сегодня: ${new Date().toLocaleDateString('ru-RU')}, календарный год 2026.
${searchBlock}
${profileBlock}
${this.buildRunaAiInternationalContract(isStartOfDialogue, clientLocalePreference)}

РЕЖИМ ПРОСТОГО ДИАЛОГА (обязателен, если к запросу это подходит):
Если сообщение пользователя — короткое приветствие, благодарность, «как дела», бытовая ремарка или эмоция БЕЗ просьбы про деньги, цифры, чек, бюджет и анализ (например: «привет», «спасибо», «ладно», «ок») — ответь по‑человечески: 1–3 коротких предложения, тёплый ненавязчивый тон. НЕ выдавай большой отчёт, НЕ перечисляй нули по доходам/расходам и блоки «Ключевые цифры», пока пользователь сам не попросил разобрать финансы или не задал вопрос про учёт. Можно в конце одним предложением напомнить, что ты помогаешь с финансами в Runa, без давления.

ГЛАВНАЯ ЗАДАЧА (когда пользователь реально спрашивает про финансы, тратит, совет или данные):
Глубоко опираться на цифры и факты из данных пользователя ниже. Давать только реальные, конкретные рекомендации. Никакой воды, токсичной мотивации, общих фраз, «бизнес-режима», стикеров и лишней болтовни. Сначала мысленно сверь транзакции, категории, цели и долги; в ответе не раскрывай внутренний ход мыслей — только ясный результат по запросу.

ИСТОЧНИКИ ДОХОДА:
Про структуру доходов суди только по тем данным, что есть в приложении (категории доходов, операции, суммы). Не выдумывай работодателя или подработки. Если пользователь спрашивает «откуда доход», опиши, что видно по учёту, и честно отметь пробелы.

КАРЬЕРА, ФРИЛАНС, ПОИСК КЛИЕНТОВ:
Подключай советы про фриланс, смену работы, выход на заказы, профессию только если пользователь явно об этом просит (например: заработать, фриланс, подработка, клиенты, заказы, резюме, удалёнка). Иначе ограничивайся финансовым учётом, бюджетом, тратами, долгами и целями. Учитывай заявленную цель и контекст транзакций, но не навязывай карьерную повестку.

ПРАВИЛА:
- Работай только с цифрами и фактами из блоков ниже и из поиска (если есть). Не хватает данных — прямо скажи и попроси уточнить.
- Будь предельно честным: если ситуация тяжёлая — прямо, по‑дружески, без драмы.
- В один ответ давай максимум 2–3 самых сильных действия, которые реально двигают ситуацию.
- Структура «пять блоков» (диагноз, цифры, риски, рекомендации, вопросы) применяй ТОЛЬКО когда пользователь просит анализ, совет по деньгам или явно обсуждает траты/доходы. В режиме простого диалога — не используй эту структуру.

АНАЛИЗИРУЙ (когда релевантно к вопросу):
- Структура доходов и расходов, крупные и малополезные категории трат.
- Динамика за несколько месяцев: используй блок «ТРЕНД ПО МЕСЯЦАМ», если он есть; иначе только текущий месяц и последние операции.
- Cash flow, риски дефицита, безубыточность по факту доход/расход за период с данными.
- Налоговые следствия — только осторожно и в бытовой формулировке, без обещаний и без роли бухгалтера.

СТИЛЬ:
Сухой, прямой, профессиональный. Без маркета и без заголовков с «решёткой». Списки — через дефис или нумерация. Не используй ** для «жирного». Эмодзи: только разовое приветствие из RUNA AI — RESPONSE CONTRACT; иначе без эмодзи, пока пользователь сам не попросит неформальный формат.

КОМПЕТЕНЦИЯ:
Банкинг, платежи, карты, кредиты (общие принципы, без обещаний), накопления и цели, личный бюджет, ориентиры ЦБ/официальные источники для фактов. Не давай инвестконсультаций с обещанием дохода.

ДЕТАЛЬНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ:

📊 ТЕКУЩИЙ МЕСЯЦ:
- Доходы: ${Number(currentMonth.income).toLocaleString('ru-RU')} ₽
- Расходы: ${Number(currentMonth.expense).toLocaleString('ru-RU')} ₽
- Остаток: ${Number(currentMonth.net).toLocaleString('ru-RU')} ₽
- Норма сбережений: ${ctx.savingsRate != null ? Number(ctx.savingsRate).toFixed(1) : '0'}%

${
  Array.isArray(ctx.monthlyTrend) && ctx.monthlyTrend.length > 0
    ? `ТРЕНД ПО МЕСЯЦАМ (до 3 календарных месяцев, только из учёта):\n${ctx.monthlyTrend
        .map(
          (m: { yearMonth: string; income: number; expense: number; net: number }) =>
            `- ${m.yearMonth}: доход ${Number(m.income).toLocaleString('ru-RU')} ₽, расход ${Number(m.expense).toLocaleString('ru-RU')} ₽, остаток ${Number(m.net).toLocaleString('ru-RU')} ₽`,
        )
        .join('\n')}\n`
    : ''
}
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
      const paymentText = ca.nextPaymentDate ? ` (платёж ${paymentDate})` : '';
      const endDate = ca.maturityDate ? new Date(ca.maturityDate).toLocaleDateString('ru-RU') : '';
      const endText = ca.maturityDate ? ` (до ${endDate})` : '';
      return `- ${ca.name}: долг ${Number(ca.currentDebt).toLocaleString('ru-RU')} ₽${limitText}${paymentText}${endText}`;
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
- График/диаграмма: только если пользователь явно просит визуализацию — тогда добавь в ответ: [CHART_REQUEST: {"type": "DONUT", "title": "Анализ бюджета"}]
- Всегда используй суммы из данных ниже для расчётов; будь конкретен (категории, даты).
- Не используй двойные звёздочки Markdown.
- Курсы валют: только блок «АКТУАЛЬНЫЕ КУРСЫ ЦБ РФ» ниже и дата; не подставляй курсы из памяти.
- Факты вне приложения и курсов: только блок поиска, если он есть; иначе честно скажи, что данных нет.

ЯЗЫК ОТВЕТА (приоритет):
1) Язык последнего сообщения пользователя — главный сигнал (русский, английский, другой).
2) Если однозначно непонятно — ориентир на UI LOCALE из контракта RUNA AI выше.
Не смешивай языки в одном ответе без запроса пользователя.
Контракт RUNA AI — RESPONSE CONTRACT обязателен по смыслу на любых языках.
`.trim();
  }

  private async callGrok(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    conversationTurns: LlmConversationTurn[] = [],
    clientLocalePreference: 'ru' | 'en' = 'ru',
  ): Promise<LLMResponse> {
    if (!this.grokApiKey) {
      throw new Error('Grok не настроен: задайте GROK_API_KEY или XAI_API_KEY в .env');
    }

    const systemPrompt = this.buildSystemPrompt(
      structuredOutputs,
      financeContext,
      webSearchResults,
      clientLocalePreference,
      conversationTurns,
    );

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
    conversationTurns: LlmConversationTurn[] = [],
    clientLocalePreference: 'ru' | 'en' = 'ru',
  ): Promise<LLMResponse> {
    const systemPrompt = this.buildSystemPrompt(
      structuredOutputs,
      financeContext,
      webSearchResults,
      clientLocalePreference,
      conversationTurns,
    );

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

  /**
   * Мультимодальный запрос OpenAI — анализ изображений (видит чеки, текст на фото).
   */
  private async callOpenAiVisionChat(
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
    webSearchResults: WebSearchResult[] = [],
    conversationTurns: LlmConversationTurn[] = [],
    imageMime: string,
    imageBase64: string,
    maxTokens: number,
    compactAnswer: boolean,
    clientLocalePreference: 'ru' | 'en' = 'ru',
  ): Promise<LLMResponse> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI не настроен');
    }
    const systemPrompt = this.buildSystemPrompt(
      structuredOutputs,
      financeContext,
      webSearchResults,
      clientLocalePreference,
      conversationTurns,
    );
    const visionHint = compactAnswer
      ? '\n\n[Режим бесплатного тарифа: ответь максимально кратко — 2–5 коротких предложений или маркированный список, без длинных вступлений.]'
      : '';
    const dataUrl = `data:${imageMime};base64,${imageBase64.replace(/\s/g, '')}`;

    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (let i = 0; i < conversationTurns.length; i++) {
      const t = conversationTurns[i];
      if (!t) continue;
      const isLastUser = t.role === 'user' && i === conversationTurns.length - 1;
      if (!isLastUser) {
        messages.push({ role: t.role, content: t.content });
        continue;
      }
      const cap = (t.content || '').trim() || 'Пользователь прислал изображение без текста.';
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${cap}${visionHint}\n\nПроанализируй изображение. Если это чек, выписка или документ по финансам — выдели суммы, даты и суть. Если не финансы — кратко опиши, что видишь. Пиши без **звёздочек** для жирного.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl,
              detail: compactAnswer ? 'low' : 'auto',
            },
          },
        ],
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.openaiVisionModel,
        messages,
        temperature: Math.min(this.temperature, 0.9),
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(this.llmFetchTimeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errData: unknown;
      try {
        errData = JSON.parse(errText);
      } catch {
        errData = { message: errText || response.statusText };
      }
      this.logger.error(`[OpenAI Vision] API error (${response.status}): ${JSON.stringify(errData)}`);
      throw new Error(`OpenAI Vision API error: ${JSON.stringify(errData)}`);
    }

    const rawBody = await response.text();
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      data = JSON.parse(rawBody);
    } catch {
      this.logger.error('[OpenAI Vision] Invalid JSON in response');
      throw new Error('OpenAI Vision API returned invalid JSON');
    }
    const text =
      data.choices?.[0]?.message?.content ||
      'Не удалось прочитать ответ по изображению. Попробуйте другое фото.';

    return {
      text,
      tokensUsed: {
        input: data.usage?.prompt_tokens || 0,
        output: data.usage?.completion_tokens || 0,
      },
      model: this.openaiVisionModel,
    };
  }

  /**
   * Распознавание речи (Whisper). Нужен OPENAI_API_KEY.
   */
  async transcribeAudioBuffer(buffer: Buffer, filename: string, mime?: string): Promise<string> {
    if (!this.openaiApiKey) {
      throw new Error('Голосовой ввод недоступен: задайте OPENAI_API_KEY на сервере.');
    }
    const form = new FormData();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'audio.m4a';
    const blob = new Blob([new Uint8Array(buffer)], {
      type: mime || 'application/octet-stream',
    });
    form.append('file', blob, safeName);
    form.append('model', 'whisper-1');
    form.append('language', 'ru');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(Math.min(120000, this.llmFetchTimeoutMs)),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`[Whisper] ${response.status}: ${errText}`);
      throw new Error(`Whisper API error: ${errText || response.statusText}`);
    }
    const data = (await response.json()) as { text?: string };
    const text = (data.text || '').trim();
    if (!text.length) {
      throw new Error('Не удалось распознать речь. Попробуйте говорить ближе к микрофону.');
    }
    return text;
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
