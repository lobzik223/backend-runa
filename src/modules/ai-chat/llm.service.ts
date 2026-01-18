import { Injectable, Logger } from '@nestjs/common';
import { AIStructuredOutput } from './ai-rules-engine.service';
import { env } from '../../config/env.validation';

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
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL || 'gpt-5-nano';

  /**
   * Convert structured outputs to natural language
   */
  async generateResponse(
    userMessage: string,
    structuredOutputs: AIStructuredOutput[],
    financeContext: any,
  ): Promise<LLMResponse> {
    if (!this.apiKey) {
      // Stub mode - return formatted structured outputs
      return this.generateStubResponse(structuredOutputs);
    }

    // Real LLM integration
    try {
      return await this.callOpenAI(userMessage, structuredOutputs, financeContext);
    } catch (error) {
      this.logger.error(`LLM error: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to stub
      return this.generateStubResponse(structuredOutputs);
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
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
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
        model: this.model,
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
