import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminPromoCodesService } from './admin-promocodes.service';
import { CreatePromoDto } from './dto/create-promo.dto';

@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminPromoCodesController {
  constructor(private readonly promoCodes: AdminPromoCodesService) {}

  @Get('promocodes')
  list() {
    return this.promoCodes.list();
  }

  @Get('promocodes/:id/stats')
  getStats(@Param('id') id: string) {
    return this.promoCodes.getStats(id);
  }

  @Post('promocodes')
  create(@Body() dto: CreatePromoDto) {
    return this.promoCodes.create(dto);
  }
}
