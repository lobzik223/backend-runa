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
import type { ChatMessageDto } from './dto/chat-message.dto';
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
  /** Анализы фото за сегодня (USER с hasImageAttachment), только Free */
  visionAnalysesUsedToday?: number;
  visionAnalysesLimitPerDay?: number;
  visionAnalysesRemainingToday?: number;
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
  /** Анализов фото за сутки на Free */
  private readonly FREE_TIER_VISION_PER_DAY = Math.max(
    1,
    Number(process.env.AI_CHAT_FREE_VISION_PER_DAY) || 3,
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

  async sendMessage(userId: number, dto: ChatMessageDto): Promise<ChatResponse> {
    const threadId = dto.threadId;
    const preferredLanguage = dto.preferredLanguage;
    const userMessage = (dto.message ?? '').trim();
    const imagePayload = this.parseImagePayload(dto);

    const step = (name: string) => (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[AI Chat] Failed at step "${name}": ${msg}`);
      throw err;
    };

    try {
      if (!userMessage.length && !imagePayload) {
        throw new BadRequestException('Введите текст или прикрепите фото.');
      }
      const safetyCheck = this.llmService.validateUserMessage(userMessage || 'На изображении может быть финансовый документ.');
      if (!safetyCheck.safe) {
        throw new BadRequestException(safetyCheck.reason);
      }

      const userPremium = await this.isUserPremium(userId);

      await this.cleanupOldMessages(userId).catch(step('cleanupOldMessages'));

      if (imagePayload) {
        const approxBytes = (imagePayload.base64.length * 3) / 4;
        if (approxBytes > 5 * 1024 * 1024) {
          throw new BadRequestException('Фото слишком большое. Выберите снимок поменьше.');
        }
        if (!userPremium) {
          await this.checkVisionLimit(userId);
        }
      }

      await this.checkMessageLimit(userId);

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
        const titleSeed = userMessage || 'Фото в чате';
        thread = await this.prisma.aiThread.create({
          data: {
            userId,
            title: titleSeed.substring(0, 50),
          },
        });
      }

      const contentForDb = userMessage.length ? userMessage : '(📷 изображение)';

      await this.prisma.aiMessage.create({
        data: {
          userId,
          threadId: thread.id,
          role: 'USER',
          content: contentForDb,
          hasImageAttachment: !!imagePayload,
        },
      });

      let financeContext: FinanceContext;
      try {
        financeContext = await this.financeContextService.getFinanceContext(userId);
      } catch (ctxErr) {
        const m = ctxErr instanceof Error ? ctxErr.message : String(ctxErr);
        this.logger.warn(`[AI Chat] getFinanceContext failed, empty context: ${m}`);
        financeContext = createEmptyFinanceContext();
      }

      let structuredOutputs = this.rulesEngine.analyze(financeContext);

      const isChartRequest = userMessage.length > 0 && this.detectChartRequest(userMessage);
      let chartData = null;

      if (isChartRequest) {
        const dateRange = this.extractDateRange(userMessage);
        chartData = await this.chartDataService
          .getDonutChartData(userId, dateRange?.start, dateRange?.end)
          .catch(step('getDonutChartData'));

        structuredOutputs.push({
          type: 'chart_request',
          payload: {
            title: 'График доходов и расходов',
            chartType: 'donut',
            data: chartData,
          },
        });
      }

      const searchQuery = userMessage || 'финансы чек расходы изображение';
      const webSearchResults = await this.webSearchService.search(searchQuery);

      const conversationForLlm = await this.loadConversationForLlm(thread.id);

      const llmResponse = await this.llmService
        .generateResponse(
          userMessage || 'Пользователь прислал изображение для анализа.',
          structuredOutputs,
          financeContext,
          webSearchResults,
          preferredLanguage,
          conversationForLlm,
          imagePayload
            ? {
                vision: { base64: imagePayload.base64, mime: imagePayload.mime },
                compactOutput: !userPremium,
              }
            : undefined,
        )
        .catch(step('generateResponse'));

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

  async transcribeVoice(userId: number, audioBase64: string, mimeType?: string): Promise<{ text: string }> {
    void userId;
    const clean = audioBase64.replace(/\s/g, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(clean, 'base64');
    } catch {
      throw new BadRequestException('Некорректные данные аудио.');
    }
    if (buffer.length < 200) {
      throw new BadRequestException('Запись слишком короткая.');
    }
    if (buffer.length > 2.5 * 1024 * 1024) {
      throw new BadRequestException('Запись слишком длинная.');
    }
    const ext =
      mimeType?.includes('webm') ? 'webm' : mimeType?.includes('wav') ? 'wav' : 'm4a';
    const filename = `voice-${userId}.${ext}`;
    const mt = mimeType || 'audio/m4a';
    try {
      const text = await this.llmService.transcribeAudioBuffer(buffer, filename, mt);
      return { text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[AI Chat] transcribeVoice: ${msg}`);
      throw new BadRequestException(msg || 'Не удалось распознать речь.');
    }
  }

  private parseImagePayload(
    dto: ChatMessageDto,
  ): { base64: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null {
    const raw = dto.imageBase64?.trim();
    if (!raw) return null;
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i.exec(raw);
    if (m?.[1] && m[2]) {
      const mime = m[1].toLowerCase() as 'image/jpeg' | 'image/png' | 'image/webp';
      return { mime, base64: m[2].replace(/\s/g, '') };
    }
    const mime = (dto.imageMimeType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
    return { base64: raw.replace(/\s/g, ''), mime };
  }

  private async isUserPremium(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    return user?.subscription?.status === 'ACTIVE';
  }

  private async checkVisionLimit(userId: number) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const used = await this.prisma.aiMessage.count({
      where: {
        userId,
        role: AiRole.USER,
        hasImageAttachment: true,
        createdAt: { gte: todayStart },
      },
    });
    if (used >= this.FREE_TIER_VISION_PER_DAY) {
      throw new BadRequestException(
        `На бесплатном тарифе доступно ${this.FREE_TIER_VISION_PER_DAY} анализа фото в сутки. Оформите Premium для безлимита или попробуйте завтра.`,
      );
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
    const visionToday = await this.prisma.aiMessage.count({
      where: {
        userId,
        role: 'USER',
        hasImageAttachment: true,
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
      visionAnalysesUsedToday: visionToday,
      visionAnalysesLimitPerDay: this.FREE_TIER_VISION_PER_DAY,
      visionAnalysesRemainingToday: Math.max(0, this.FREE_TIER_VISION_PER_DAY - visionToday),
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
