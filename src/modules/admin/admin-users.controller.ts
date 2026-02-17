import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminUsersService } from './admin-users.service';

@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit || '20'), 10) || 20));
    return this.users.list(search, pageNum, limitNum);
  }

  @Get('users/:id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.getOne(id);
  }

  @Post('users/:id/block')
  block(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string; until?: string },
  ) {
    const until = body.until ? new Date(body.until) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (isNaN(until.getTime())) throw new BadRequestException('Некорректная дата until');
    return this.users.blockUser(id, body.reason ?? 'Заблокировано администратором', until);
  }

  @Post('users/:id/unblock')
  unblock(@Param('id', ParseIntPipe) id: number) {
    return this.users.unblockUser(id);
  }
}
