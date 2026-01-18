import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { PremiumGuard } from './entitlements.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EntitlementsService, PremiumGuard],
  exports: [EntitlementsService, PremiumGuard],
})
export class SubscriptionsModule {}
