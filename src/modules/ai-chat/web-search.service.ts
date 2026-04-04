import { Injectable, Logger } from '@nestjs/common';

export interface WebSearchResult {
  title: string;
  snippet: string;
  link: string;
}

/**
 * Поиск в интернете (Serper) для подстановки актуальных данных в контекст LLM.
 * Без SERPER_API_KEY поиск не выполняется — модель работает только по данным приложения и ЦБ.
 */
@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly apiKey = process.env.SERPER_API_KEY;
  private readonly endpoint = 'https://google.serper.dev/search';
  private readonly resultLimit = Math.min(
    12,
    Math.max(4, Number(process.env.SERPER_RESULT_LIMIT) || 8),
  );

  constructor() {
    if (this.apiKey) {
      this.logger.log('[WebSearch] Serper включён — в контекст AI подставляются актуальные данные из поиска.');
    } else {
      this.logger.log('[WebSearch] SERPER_API_KEY не задан — поиск отключён. Задай ключ в .env для актуальных курсов/дат/фактов.');
    }
  }

  /**
   * Обогащает запрос для лучшего покрытия банкинга/финансов и актуальных фактов.
   */
  private buildSerperQuery(raw: string): string {
    const base = raw.trim().slice(0, 160);
    const lower = base.toLowerCase();
    const financeHints = [
      'банк',
      'кредит',
      'вклад',
      'ипотек',
      'карта',
      'счёт',
      'счет',
      'перевод',
      'сбп',
      'валют',
      'курс',
      'цб',
      'накоплен',
      'депозит',
      'рефинанс',
    ];
    const looksFinance = financeHints.some((h) => lower.includes(h));
    const tail = looksFinance
      ? 'банки Россия финансы актуально'
      : 'финансы личные деньги актуально';
    const q = `${base} ${tail} 2026`.replace(/\s+/g, ' ').trim();
    return q.slice(0, 220);
  }

  /**
   * Выполняет поиск по запросу. Сниппеты для контекста LLM (Serper organic).
   */
  async search(query: string, limit?: number): Promise<WebSearchResult[]> {
    if (!this.apiKey?.trim()) {
      return [];
    }
    const lim = limit ?? this.resultLimit;
    const q = this.buildSerperQuery(query);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`[WebSearch] Serper error ${res.status}`);
        return [];
      }
      const data = (await res.json()) as {
        organic?: Array<{ title?: string; snippet?: string; link?: string }>;
      };
      const organic = data?.organic ?? [];
      return organic.slice(0, lim).map((o) => ({
        title: o.title ?? '',
        snippet: o.snippet ?? '',
        link: o.link ?? '',
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[WebSearch] Request failed: ${msg}`);
      return [];
    }
  }
}
