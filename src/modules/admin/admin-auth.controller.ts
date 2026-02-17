import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import type { AdminJwtPayload } from './admin-auth.types';

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('auth/login')
  @Throttle({ default: { limit: 5, ttl: 60 } }) // 5 попыток в минуту против брутфорса
  async login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  async me(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminAuth.me(admin.sub);
  }

  @Post('auth/verify-password')
  @UseGuards(AdminJwtGuard)
  async verifyPassword(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: { password?: string }) {
    return this.adminAuth.verifyPassword(admin.sub, body.password ?? '');
  }
}
