import { Controller, Get, Post, Body } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { env } from '../../config/env.validation';

@Controller('health')
export class HealthController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  async health() {
    const maintenance = await this.maintenance.isEnabled();
    return {
      status: 'ok',
      message: 'RUNA backend is healthy',
      maintenance,
    };
  }

  /** Публичный конфиг приложения (без авторизации). Ссылка на поддержку в Telegram — можно менять через SUPPORT_TELEGRAM_URL в .env */
  @Get('config')
  getAppConfig() {
    return {
      supportTelegramUrl: env.SUPPORT_TELEGRAM_URL,
    };
  }

  /**
   * Включить/выключить режим «Ведутся работы».
   * Требуется заголовок X-Runa-App-Key (если APP_KEY задан в .env).
   */
  @Post('maintenance')
  async setMaintenance(@Body() body: { enabled: boolean }) {
    await this.maintenance.setEnabled(!!body.enabled);
    const maintenance = await this.maintenance.isEnabled();
    return { maintenance };
  }
}

