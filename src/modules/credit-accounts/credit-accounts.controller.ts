import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CreditAccountsService } from './credit-accounts.service';
import { CreateCreditAccountDto } from './dto/create-credit-account.dto';
import { UpdateCreditAccountDto } from './dto/update-credit-account.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('credit-accounts')
@UseGuards(JwtAccessGuard)
export class CreditAccountsController {
  constructor(private readonly creditAccountsService: CreditAccountsService) {}

  @Post()
  create(@CurrentUser() user: JwtAccessPayload, @Body() createDto: CreateCreditAccountDto) {
    return this.creditAccountsService.create(user.sub, createDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtAccessPayload) {
    return this.creditAccountsService.findAll(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.creditAccountsService.findOne(user.sub, parseInt(id, 10));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateCreditAccountDto,
  ) {
    return this.creditAccountsService.update(user.sub, parseInt(id, 10), updateDto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.creditAccountsService.remove(user.sub, parseInt(id, 10));
  }
}
