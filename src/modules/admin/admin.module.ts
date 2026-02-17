import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminPromoCodesController } from './admin-promocodes.controller';
import { AdminPromoCodesService } from './admin-promocodes.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    PaymentsModule,
    JwtModule.register({}), // секрет передаётся при sign (JWT_ADMIN_SECRET)
  ],
  controllers: [
    AdminAuthController,
    AdminStatsController,
    AdminUsersController,
    AdminPromoCodesController,
    AdminPaymentsController,
  ],
  providers: [AdminAuthService, AdminJwtStrategy, AdminStatsService, AdminUsersService, AdminPromoCodesService],
  exports: [AdminAuthService],
})
export class AdminModule {}
