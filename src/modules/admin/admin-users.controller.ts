import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
}
