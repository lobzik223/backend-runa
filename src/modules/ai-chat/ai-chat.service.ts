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
  private readonly FREE_TIER_MESSAGE_LIMIT = 10; // per day
  private readonly PREMIUM_TIER_MESSAGE_LIMIT = 1000; // effectively unlimited

  constructor(
    private prisma: PrismaService,
    private financeContextService: FinanceContextService,
    private rulesEngine: AIRulesEngineService,
    private llmService: LLMService,
    private chartDataService: ChartDataService,
  ) {}

  async sendMessage(
    userId: number,
    userMessage: string,
    threadId?: string,
  ): Promise<ChatResponse> {
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

    // Generate LLM response
    const llmResponse = await this.llmService.generateResponse(
      userMessage,
      structuredOutputs,
      financeContext,
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
    const limit = isPremium ? this.PREMIUM_TIER_MESSAGE_LIMIT : this.FREE_TIER_MESSAGE_LIMIT;

    // Count messages today
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
        `Достигнут лимит сообщений (${limit} в день). ${isPremium ? '' : 'Перейдите на Premium для увеличения лимита.'}`,
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
