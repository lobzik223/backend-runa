import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaymentMethodType } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('payment-methods')
@UseGuards(JwtAccessGuard)
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload, @Query('type') type?: PaymentMethodType) {
    return this.paymentMethods.list(user.sub, type);
  }
}

