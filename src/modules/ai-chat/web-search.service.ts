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

  constructor() {
    if (this.apiKey) {
      this.logger.log('[WebSearch] Serper включён — в контекст AI подставляются актуальные данные из поиска.');
    } else {
      this.logger.log('[WebSearch] SERPER_API_KEY не задан — поиск отключён. Задай ключ в .env для актуальных курсов/дат/фактов.');
    }
  }

  /**
   * Выполняет поиск по запросу. Возвращает до 8 сниппетов для контекста LLM.
   */
  async search(query: string, limit = 8): Promise<WebSearchResult[]> {
    if (!this.apiKey?.trim()) {
      return [];
    }
    const q = `${query.trim()} актуальные данные 2026`.slice(0, 200);
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
      return organic.slice(0, limit).map((o) => ({
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
