import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceContextService, FinanceContext } from './finance-context.service';
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

export interface ChatResponse {
  message: string;
  structuredOutputs?: AIStructuredOutput[];
  chartData?: any; // DonutChartData if chart requested
  threadId: string;
  messageId: string;
}

@Injectable()
export class AIChatService {
  private readonly logger = new Logger(AIChatService.name);
  private readonly FREE_TIER_MESSAGE_LIMIT = 12; // 12 обращений в день для Free
  private readonly FREE_TIER_TOKEN_LIMIT = 20000; // 20.000 токенов общий лимит для Free
  private readonly PREMIUM_TIER_MESSAGE_LIMIT = 1000; // effectively unlimited

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
    // 1. Очистка старых сообщений перед обработкой нового
    await this.cleanupOldMessages(userId);

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
    const userMsg = await this.prisma.aiMessage.create({
      data: {
        userId,
        threadId: thread.id,
        role: 'USER',
        content: userMessage,
      },
    });

    // Get finance context
    const financeContext = await this.financeContextService.getFinanceContext(userId);

    // Run rules engine
    let structuredOutputs = this.rulesEngine.analyze(financeContext);

    // Check if user is requesting charts
    const isChartRequest = this.detectChartRequest(userMessage);
    let chartData = null;

    if (isChartRequest) {
      // Extract date range from message if specified
      const dateRange = this.extractDateRange(userMessage);
      chartData = await this.chartDataService.getDonutChartData(
        userId,
        dateRange?.start,
        dateRange?.end,
      );

      // Add chart request to structured outputs
      structuredOutputs.push({
        type: 'chart_request',
        payload: {
          title: 'График доходов и расходов',
          chartType: 'donut',
          data: chartData,
        },
      });
    }

    // Поиск актуальных данных по запросу пользователя (курсы, даты, факты)
    const webSearchResults = await this.webSearchService.search(userMessage);

    // Generate LLM response (language: from param or detect from message)
    const llmResponse = await this.llmService.generateResponse(
      userMessage,
      structuredOutputs,
      financeContext,
      webSearchResults,
      preferredLanguage,
    );

    // Save assistant message
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

    return {
      message: llmResponse.text,
      structuredOutputs,
      chartData: chartData || undefined,
      threadId: thread.id,
      messageId: assistantMsg.id,
    };
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
        `У вас закончился дневной лимит (12 обращений). Воспользуйтесь премиум подпиской для неограниченного общения.`,
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
        `У вас закончился общий лимит токенов (20,000). Воспользуйтесь премиум подпиской для продолжения.`,
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
