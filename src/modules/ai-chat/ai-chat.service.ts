import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { AiRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceContextService, FinanceContext, createEmptyFinanceContext } from './finance-context.service';
import { AIRulesEngineService, AIStructuredOutput } from './ai-rules-engine.service';
import { LLMService } from './llm.service';
import { ChartDataService } from './chart-data.service';
import { WebSearchService } from './web-search.service';
import dayjs from 'dayjs';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  structuredOutputs?: AIStructuredOutput[];
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/** Статистика лимитов для клиента (Free) или флаг Premium */
export interface ChatUsageInfo {
  isPremium: boolean;
  dailyMessageLimit?: number;
  messagesUsedToday?: number;
  messagesRemainingToday?: number;
  totalTokenLimit?: number;
  tokensUsedTotal?: number;
  tokensRemainingApprox?: number;
}

export interface ChatResponse {
  message: string;
  structuredOutputs?: AIStructuredOutput[];
  chartData?: any; // DonutChartData if chart requested
  threadId: string;
  messageId: string;
  usage?: ChatUsageInfo;
}

@Injectable()
export class AIChatService {
  private readonly logger = new Logger(AIChatService.name);
  /** Обращений к AI в день (Free). Переопределение: AI_CHAT_FREE_DAILY_MESSAGES */
  private readonly FREE_TIER_MESSAGE_LIMIT = Math.max(
    1,
    Number(process.env.AI_CHAT_FREE_DAILY_MESSAGES) || 12,
  );
  /** Суммарный лимит токенов (Free). Переопределение: AI_CHAT_FREE_TOKEN_LIMIT */
  private readonly FREE_TIER_TOKEN_LIMIT = Math.max(
    1000,
    Number(process.env.AI_CHAT_FREE_TOKEN_LIMIT) || 20000,
  );
  private readonly LLM_HISTORY_MAX_MESSAGES = Math.min(
    64,
    Math.max(4, Number(process.env.AI_CHAT_HISTORY_MAX_MESSAGES) || 32),
  );

  constructor(
    private prisma: PrismaService,
    private financeContextService: FinanceContextService,
    private rulesEngine: AIRulesEngineService,
    private llmService: LLMService,
    private chartDataService: ChartDataService,
    private webSearchService: WebSearchService,
  ) {}

  async sendMessage(
    userId: number,
    userMessage: string,
    threadId?: string,
    preferredLanguage?: 'ru' | 'en',
  ): Promise<ChatResponse> {
    const step = (name: string) => (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[AI Chat] Failed at step "${name}": ${msg}`);
      throw err;
    };

    try {
      // 1. Очистка старых сообщений перед обработкой нового
      await this.cleanupOldMessages(userId).catch(step('cleanupOldMessages'));

      // Validate message safety
      const safetyCheck = this.llmService.validateUserMessage(userMessage);
      if (!safetyCheck.safe) {
        throw new BadRequestException(safetyCheck.reason);
      }

      // Check message limits
      await this.checkMessageLimit(userId);

      // Get or create thread
      let thread;
      if (threadId) {
        thread = await this.prisma.aiThread.findUnique({
          where: { id: threadId },
        });
        if (!thread) {
          throw new BadRequestException('Thread not found');
        }
        if (thread.userId !== userId) {
          throw new ForbiddenException('Thread does not belong to user');
        }
      } else {
        thread = await this.prisma.aiThread.create({
          data: {
            userId,
            title: userMessage.substring(0, 50), // Auto-title from first message
          },
        });
      }

      // Save user message
      await this.prisma.aiMessage.create({
        data: {
          userId,
          threadId: thread.id,
          role: 'USER',
          content: userMessage,
        },
      });

      // Финансовый контекст: при сбое БД/таймаута — пустой контекст, чтобы чат не отваливался целиком
      let financeContext: FinanceContext;
      try {
        financeContext = await this.financeContextService.getFinanceContext(userId);
      } catch (ctxErr) {
        const m = ctxErr instanceof Error ? ctxErr.message : String(ctxErr);
        this.logger.warn(`[AI Chat] getFinanceContext failed, empty context: ${m}`);
        financeContext = createEmptyFinanceContext();
      }

      // Run rules engine
      let structuredOutputs = this.rulesEngine.analyze(financeContext);

      // Check if user is requesting charts
      const isChartRequest = this.detectChartRequest(userMessage);
      let chartData = null;

      if (isChartRequest) {
        const dateRange = this.extractDateRange(userMessage);
        chartData = await this.chartDataService.getDonutChartData(
          userId,
          dateRange?.start,
          dateRange?.end,
        ).catch(step('getDonutChartData'));

        structuredOutputs.push({
          type: 'chart_request',
          payload: {
            title: 'График доходов и расходов',
            chartType: 'donut',
            data: chartData,
          },
        });
      }

      const webSearchResults = await this.webSearchService.search(userMessage);

      const conversationForLlm = await this.loadConversationForLlm(thread.id);

      const llmResponse = await this.llmService.generateResponse(
        userMessage,
        structuredOutputs,
        financeContext,
        webSearchResults,
        preferredLanguage,
        conversationForLlm,
      ).catch(step('generateResponse'));

      const assistantMsg = await this.prisma.aiMessage.create({
        data: {
          userId,
          threadId: thread.id,
          role: 'ASSISTANT',
          content: llmResponse.text,
          model: llmResponse.model,
          tokensIn: llmResponse.tokensUsed?.input,
          tokensOut: llmResponse.tokensUsed?.output,
        },
      });

      const usage = await this.buildUsageInfo(userId);

      return {
        message: llmResponse.text,
        structuredOutputs,
        chartData: chartData || undefined,
        threadId: thread.id,
        messageId: assistantMsg.id,
        usage,
      };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ForbiddenException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AI Chat] sendMessage error: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw err;
    }
  }

  /**
   * Очистка старых сообщений в зависимости от статуса подписки
   */
  private async cleanupOldMessages(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) return;

    const isPremium = user.subscription?.status === 'ACTIVE';
    const now = new Date();

    if (isPremium) {
      // Для Premium: храним 7 дней
      const sevenDaysAgo = dayjs(now).subtract(7, 'day').toDate();
      await this.prisma.aiMessage.deleteMany({
        where: {
          userId,
          createdAt: { lt: sevenDaysAgo },
        },
      });
    } else {
      // Для Free: храним 10 часов
      const tenHoursAgo = dayjs(now).subtract(10, 'hour').toDate();
      await this.prisma.aiMessage.deleteMany({
        where: {
          userId,
          createdAt: { lt: tenHoursAgo },
        },
      });
    }
  }

  /**
   * Detect if user is requesting charts
   */
  private detectChartRequest(message: string): boolean {
    const lower = message.toLowerCase();
    const chartKeywords = [
      'покажи график',
      'show chart',
      'график',
      'диаграмма',
      'визуализац',
      'покажи расходы',
      'покажи доходы',
    ];
    return chartKeywords.some((keyword) => lower.includes(keyword));
  }

  /**
   * Extract date range from user message (simple parsing)
   */
  private extractDateRange(message: string): { start?: Date; end?: Date } | null {
    const lower = message.toLowerCase();
    const now = dayjs();

    // Simple patterns
    if (lower.includes('этот месяц') || lower.includes('текущий месяц')) {
      return {
        start: now.startOf('month').toDate(),
        end: now.endOf('month').toDate(),
      };
    }

    if (lower.includes('прошлый месяц') || lower.includes('предыдущий месяц')) {
      const lastMonth = now.subtract(1, 'month');
      return {
        start: lastMonth.startOf('month').toDate(),
        end: lastMonth.endOf('month').toDate(),
      };
    }

    // TODO: Parse specific dates like "с 1 января по 31 января"
    // For now, return null to use default (current month)
    return null;
  }

  /**
   * Последние сообщения треда для LLM (включая только что сохранённое сообщение пользователя).
   * Обрезка по количеству — с начала старые отрезаются, контекст «помнит» хвост диалога.
   */
  private async loadConversationForLlm(
    threadId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const rows = await this.prisma.aiMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: this.LLM_HISTORY_MAX_MESSAGES,
      select: { role: true, content: true },
    });
    const chronological = rows.reverse();
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of chronological) {
      const text = (m.content ?? '').slice(0, 12000);
      if (!text.trim()) continue;
      if (m.role === AiRole.USER) {
        out.push({ role: 'user', content: text });
      } else if (m.role === AiRole.ASSISTANT) {
        out.push({ role: 'assistant', content: text });
      }
    }
    return out;
  }

  private async buildUsageInfo(userId: number): Promise<ChatUsageInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) {
      return { isPremium: false };
    }
    const isPremium = user.subscription?.status === 'ACTIVE';
    if (isPremium) {
      return { isPremium: true };
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const messagesUsedToday = await this.prisma.aiMessage.count({
      where: {
        userId,
        role: 'USER',
        createdAt: { gte: todayStart },
      },
    });
    const totalTokens = await this.prisma.aiMessage.aggregate({
      where: { userId },
      _sum: { tokensIn: true, tokensOut: true },
    });
    const tokensUsed =
      (totalTokens._sum.tokensIn || 0) + (totalTokens._sum.tokensOut || 0);
    const dailyLimit = this.FREE_TIER_MESSAGE_LIMIT;
    const tokenLimit = this.FREE_TIER_TOKEN_LIMIT;
    return {
      isPremium: false,
      dailyMessageLimit: dailyLimit,
      messagesUsedToday,
      messagesRemainingToday: Math.max(0, dailyLimit - messagesUsedToday),
      totalTokenLimit: tokenLimit,
      tokensUsedTotal: tokensUsed,
      tokensRemainingApprox: Math.max(0, tokenLimit - tokensUsed),
    };
  }

  private async checkMessageLimit(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const isPremium = user.subscription?.status === 'ACTIVE';
    
    // Premium пользователи не имеют жестких лимитов здесь (или они очень высокие)
    if (isPremium) return;

    // Лимиты для Free пользователей
    const limit = this.FREE_TIER_MESSAGE_LIMIT;

    // 1. Проверка количества сообщений за сегодня
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const messageCount = await this.prisma.aiMessage.count({
      where: {
        userId,
        role: 'USER',
        createdAt: {
          gte: todayStart,
        },
      },
    });

    if (messageCount >= limit) {
      throw new BadRequestException(
        `Дневной лимит AI-чата исчерпан (${limit} сообщений за сутки). Лимит обновится завтра после полуночи по времени сервера. Оформите Premium в приложении — там лимиты на сообщения сняты.`,
      );
    }

    // 2. Проверка общего лимита токенов (tokensIn + tokensOut)
    const totalTokens = await this.prisma.aiMessage.aggregate({
      where: { userId },
      _sum: {
        tokensIn: true,
        tokensOut: true,
      },
    });

    const usedTokens = (totalTokens._sum.tokensIn || 0) + (totalTokens._sum.tokensOut || 0);
    if (usedTokens >= this.FREE_TIER_TOKEN_LIMIT) {
      throw new BadRequestException(
        `Общий лимит токенов AI исчерпан (${this.FREE_TIER_TOKEN_LIMIT.toLocaleString('ru-RU')} токенов на бесплатном тарифе). Оформите Premium в приложении или дождитесь смены политики лимитов.`,
      );
    }
  }

  async getThreadHistory(threadId: string, userId: number) {
    const thread = await this.prisma.aiThread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!thread) {
      throw new BadRequestException('Thread not found');
    }

    if (thread.userId !== userId) {
      throw new ForbiddenException('Thread does not belong to user');
    }

    return thread;
  }

  async listThreads(userId: number) {
    return this.prisma.aiThread.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }
}
