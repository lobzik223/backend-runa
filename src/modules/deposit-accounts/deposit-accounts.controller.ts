import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { DepositAccountsService } from './deposit-accounts.service';
import { CreateDepositAccountDto } from './dto/create-deposit-account.dto';
import { UpdateDepositAccountDto } from './dto/update-deposit-account.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('deposit-accounts')
@UseGuards(JwtAccessGuard)
export class DepositAccountsController {
  constructor(private readonly depositAccountsService: DepositAccountsService) {}

  @Post()
  create(@CurrentUser() user: JwtAccessPayload, @Body() createDto: CreateDepositAccountDto) {
    return this.depositAccountsService.create(user.sub, createDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtAccessPayload) {
    return this.depositAccountsService.findAll(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.depositAccountsService.findOne(user.sub, parseInt(id, 10));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateDepositAccountDto,
  ) {
    return this.depositAccountsService.update(user.sub, parseInt(id, 10), updateDto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.depositAccountsService.remove(user.sub, parseInt(id, 10));
  }
}
