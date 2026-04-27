import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { PaymentMethodType } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';
import { PaymentMethodsService } from './payment-methods.service';
import { SyncWalletCardsDto } from './dto/sync-wallet-cards.dto';

@Controller('payment-methods')
@UseGuards(JwtAccessGuard)
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload, @Query('type') type?: PaymentMethodType) {
    return this.paymentMethods.list(user.sub, type);
  }

  /** Синхронизация виртуальных карт Runa (макс. 1 дебет + 1 кредит без CreditAccount). */
  @Put('wallet/sync')
  syncWallet(@CurrentUser() user: JwtAccessPayload, @Body() dto: SyncWalletCardsDto) {
    return this.paymentMethods.syncWalletCards(user.sub, dto.cards);
  }
}

