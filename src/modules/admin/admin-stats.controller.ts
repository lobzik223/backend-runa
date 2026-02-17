import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminStatsService } from './admin-stats.service';

@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('stats/dashboard')
  getDashboard() {
    return this.stats.getDashboard();
  }
}
