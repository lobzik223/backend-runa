import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TinkoffPortfolioItem {
  figi: string;
  ticker: string;
  name: string;
  type: string;
  quantity: number;
  average_price: number;
  current_price: number;
  total_cost: number;
  current_value: number;
  pnl: number;
  pnl_percent: number;
}

interface TinkoffPortfolioResponse {
  success: boolean;
  account_id?: string;
  portfolio: TinkoffPortfolioItem[];
  total_value: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_percent: number;
  error?: string;
}

interface TinkoffAccount {
  id: string;
  type: string;
  name: string;
  status: string;
  opened_date?: string;
}

interface TinkoffAccountsResponse {
  success: boolean;
  accounts: TinkoffAccount[];
  error?: string;
}

interface TinkoffInstrument {
  figi: string;
  ticker: string;
  name: string;
  type: string;
  currency: string;
}

interface TinkoffSearchResponse {
  success: boolean;
  instruments: TinkoffInstrument[];
  error?: string;
}

@Injectable()
export class TinkoffInvestService {
  private readonly logger = new Logger(TinkoffInvestService.name);
  private readonly pythonScriptPath: string;

  constructor(private prisma: PrismaService) {
    // Путь к Python скрипту относительно корня проекта.
    // В Docker/production мы кладём скрипт в /app/python/tinkoff_service.py (копируется в image).
    // В dev (вне Docker) оставляем совместимость с корневой папкой Tinkoff-invest/.
    const isProduction = __dirname.includes('dist');
    const projectRoot = isProduction
      ? path.resolve(__dirname, '../../../../..') // dist/modules/tinkoff-invest -> ../../../../../
      : path.resolve(__dirname, '../../../..'); // src/modules/tinkoff-invest -> ../../../../

    const dockerFriendly = path.join(projectRoot, 'python', 'tinkoff_service.py');
    const legacy = path.join(projectRoot, 'Tinkoff-invest', 'tinkoff_service.py');

    this.pythonScriptPath = fs.existsSync(dockerFriendly) ? dockerFriendly : legacy;
    this.logger.log(`Python script path: ${this.pythonScriptPath}`);
  }

  /**
   * Получить токен Tinkoff для пользователя
   */
  async getTinkoffToken(userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tinkoffToken: true },
    });

    return user?.tinkoffToken || null;
  }

  /**
   * Сохранить токен Tinkoff для пользователя
   */
  async setTinkoffToken(userId: number, token: string, useSandbox: boolean = false): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('Token cannot be empty');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tinkoffToken: token.trim(),
        tinkoffUseSandbox: useSandbox,
      },
    });

    this.logger.log(`Tinkoff token saved for user ${userId} (sandbox: ${useSandbox})`);
  }

  /**
   * Удалить токен Tinkoff для пользователя
   */
  async removeTinkoffToken(userId: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tinkoffToken: null,
        tinkoffUseSandbox: false,
      },
    });

    this.logger.log(`Tinkoff token removed for user ${userId}`);
  }

  /**
   * Выполнить Python скрипт с командой
   */
  private async executePythonScript(
    command: string,
    inputData: Record<string, any>,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const inputJson = JSON.stringify(inputData);
      
      // Запускаем Python процесс
      const pythonProcess = spawn('python', [this.pythonScriptPath, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      // Собираем stdout
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Собираем stderr
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Отправляем входные данные в stdin
      pythonProcess.stdin.write(inputJson);
      pythonProcess.stdin.end();

      // Обрабатываем завершение процесса
      pythonProcess.on('close', (code) => {
        if (code !== 0 && !stdout) {
          this.logger.error(`Python script error: ${stderr}`);
          reject(new Error(`Python script error: ${stderr || 'Unknown error'}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          
          if (!result.success) {
            reject(new Error(result.error || 'Unknown error from Python script'));
            return;
          }

          resolve(result);
        } catch (error: any) {
          this.logger.error(`Failed to parse Python output: ${error.message}`);
          this.logger.error(`stdout: ${stdout}`);
          this.logger.error(`stderr: ${stderr}`);
          reject(new Error('Invalid response from Tinkoff service'));
        }
      });

      pythonProcess.on('error', (error) => {
        this.logger.error(`Failed to execute Python script: ${error.message}`);
        
        if (error.message.includes('ENOENT')) {
          reject(new Error('Python not found. Please install Python 3.8+ and ensure it is in PATH.'));
        } else {
          reject(new Error(`Tinkoff service error: ${error.message}`));
        }
      });
    });
  }

  /**
   * Получить портфель из Tinkoff Invest
   * Всегда использует демо-токен из окружения
   */
  async getPortfolio(userId: number): Promise<TinkoffPortfolioResponse> {
    // Всегда используем демо-токен по умолчанию
    const demoToken = process.env.TINKOFF_DEMO_TOKEN;
    if (!demoToken) {
      throw new NotFoundException(
        'Demo mode is not available. Please configure TINKOFF_DEMO_TOKEN in environment.',
      );
    }

    return this.executePythonScript('get_portfolio', {
      token: demoToken,
      use_sandbox: true, // Всегда используем песочницу для безопасности
    });
  }

  /**
   * Получить список аккаунтов Tinkoff
   */
  async getAccounts(userId: number): Promise<TinkoffAccountsResponse> {
    const token = await this.getTinkoffToken(userId);
    if (!token) {
      throw new NotFoundException('Tinkoff token not configured. Please set your token first.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tinkoffUseSandbox: true },
    });

    const useSandbox = user?.tinkoffUseSandbox || false;

    return this.executePythonScript('get_accounts', {
      token,
      use_sandbox: useSandbox,
    });
  }

  /**
   * Поиск инструментов в Tinkoff
   * Всегда использует демо-токен из окружения
   */
  async searchInstruments(userId: number, query: string): Promise<TinkoffSearchResponse> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query cannot be empty');
    }

    // Всегда используем демо-токен по умолчанию
    const demoToken = process.env.TINKOFF_DEMO_TOKEN;
    if (!demoToken) {
      throw new NotFoundException(
        'Demo mode is not available. Please configure TINKOFF_DEMO_TOKEN in environment.',
      );
    }

    return this.executePythonScript('search_instruments', {
      token: demoToken,
      query: query.trim(),
      use_sandbox: true, // Всегда используем песочницу
    });
  }

  /**
   * Создать демо-аккаунт в песочнице Tinkoff
   */
  async createDemoAccount(): Promise<{ account_id: string; balance: any }> {
    const demoToken = process.env.TINKOFF_DEMO_TOKEN;
    if (!demoToken) {
      throw new Error('Demo mode is not available. TINKOFF_DEMO_TOKEN is not set.');
    }

    return this.executePythonScript('create_demo_account', {
      token: demoToken,
    });
  }

  /**
   * Получить текущую цену инструмента по FIGI
   */
  async getCurrentPrice(figi: string): Promise<{ success: boolean; price?: number; currency?: string; error?: string }> {
    const demoToken = process.env.TINKOFF_DEMO_TOKEN;
    if (!demoToken) {
      throw new NotFoundException('Demo mode is not available.');
    }

    return this.executePythonScript('get_current_price', {
      token: demoToken,
      figi,
      use_sandbox: true,
    });
  }

  /**
   * Синхронизировать портфель из Tinkoff в локальную БД
   */
  async syncPortfolio(userId: number): Promise<{ synced: number; errors: number }> {
    const portfolioResponse = await this.getPortfolio(userId);
    
    if (!portfolioResponse.success || !portfolioResponse.portfolio) {
      throw new Error(portfolioResponse.error || 'Failed to get portfolio from Tinkoff');
    }

    let synced = 0;
    let errors = 0;

    for (const item of portfolioResponse.portfolio) {
      try {
        // Проверяем, существует ли актив
        let asset = await this.prisma.investmentAsset.findUnique({
          where: {
            userId_symbol: {
              userId,
              symbol: item.ticker.toUpperCase(),
            },
          },
        });

        // Создаем или обновляем актив
        if (!asset) {
          asset = await this.prisma.investmentAsset.create({
            data: {
              userId,
              symbol: item.ticker.toUpperCase(),
              name: item.name,
              assetType: this.mapTinkoffTypeToAssetType(item.type),
              currency: 'RUB', // Tinkoff обычно использует RUB
              exchange: null,
            },
          });
        }

        // Проверяем, есть ли уже лот с такой информацией
        // Для простоты, создаем новый лот если его нет
        // В реальности нужно более сложная логика синхронизации
        
        synced++;
      } catch (error: any) {
        this.logger.error(`Failed to sync asset ${item.ticker}: ${error.message}`);
        errors++;
      }
    }

    return { synced, errors };
  }

  /**
   * Маппинг типа из Tinkoff в AssetType
   */
  private mapTinkoffTypeToAssetType(tinkoffType: string): 'STOCK' | 'BOND' | 'ETF' | 'CRYPTO' | 'OTHER' {
    const upper = tinkoffType.toUpperCase();
    if (upper.includes('SHARE') || upper.includes('STOCK')) return 'STOCK';
    if (upper.includes('BOND')) return 'BOND';
    if (upper.includes('ETF')) return 'ETF';
    if (upper.includes('CRYPTO')) return 'CRYPTO';
    return 'OTHER';
  }
}
