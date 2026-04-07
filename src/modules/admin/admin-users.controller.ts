import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminUsersService } from './admin-users.service';
import { AdminAuthService } from './admin-auth.service';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import type { AdminJwtPayload } from './admin-auth.types';

@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Get('users')
  list(
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    /** Панель: нужен просмотр всех пользователей сразу; верхний предел защищает от случайного запроса миллионов строк. */
    const limitNum = Math.min(2000, Math.max(1, parseInt(String(limit || '20'), 10) || 20));
    const userIdNum = userId != null && userId.trim() !== '' ? parseInt(userId.trim(), 10) : undefined;
    if (userIdNum !== undefined && (Number.isNaN(userIdNum) || userIdNum < 1)) {
      throw new BadRequestException('ID пользователя должен быть положительным числом');
    }
    return this.users.list({ search: search?.trim(), userId: userIdNum }, pageNum, limitNum);
  }

  @Get('users/:id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.getOne(id);
  }

  @Post('users/:id/block')
  async block(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string; until?: string; password?: string },
  ) {
    if (!body.password?.trim()) throw new BadRequestException('Введите пароль для подтверждения');
    await this.adminAuth.verifyPassword(admin.sub, body.password);
    const until = body.until ? new Date(body.until) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(until.getTime())) throw new BadRequestException('Некорректная дата until');
    return this.users.blockUser(id, body.reason ?? 'Заблокировано администратором', until);
  }

  @Post('users/:id/unblock')
  async unblock(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password?: string },
  ) {
    if (!body?.password?.trim()) throw new BadRequestException('Введите пароль для подтверждения');
    await this.adminAuth.verifyPassword(admin.sub, body.password);
    return this.users.unblockUser(id);
  }

  @Post('users/:id/subscription/grant')
  async grantSubscription(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { days?: number; password?: string },
  ) {
    if (!body?.password?.trim()) throw new BadRequestException('Введите пароль для подтверждения');
    await this.adminAuth.verifyPassword(admin.sub, body.password);
    const days = Math.max(1, Math.min(366, Number(body.days) || 30));
    return this.users.grantSubscription(id, days);
  }

  @Post('users/:id/subscription/reduce')
  async reduceSubscription(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { days?: number; password?: string },
  ) {
    if (!body?.password?.trim()) throw new BadRequestException('Введите пароль для подтверждения');
    await this.adminAuth.verifyPassword(admin.sub, body.password);
    const days = Math.max(1, Math.min(360, Number(body.days) || 1));
    return this.users.reduceSubscription(id, days);
  }

  @Post('users/:id/subscription/revoke')
  async revokeSubscription(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password?: string },
  ) {
    if (!body?.password?.trim()) throw new BadRequestException('Введите пароль для подтверждения');
    await this.adminAuth.verifyPassword(admin.sub, body.password);
    return this.users.revokeSubscription(id);
  }
}
