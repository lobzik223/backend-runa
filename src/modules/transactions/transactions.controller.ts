import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { AnalyticsDto } from './dto/analytics.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('transactions')
@UseGuards(JwtAccessGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@CurrentUser() user: JwtAccessPayload, @Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(user.sub, createTransactionDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtAccessPayload, @Query() query: ListTransactionsDto) {
    return this.transactionsService.findAll(user.sub, query);
  }

  @Get('analytics')
  getAnalytics(@CurrentUser() user: JwtAccessPayload, @Query() query: AnalyticsDto) {
    return this.transactionsService.getAnalytics(user.sub, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.transactionsService.findOne(user.sub, BigInt(id));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id') id: string,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(user.sub, BigInt(id), updateTransactionDto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtAccessPayload, @Param('id') id: string) {
    return this.transactionsService.remove(user.sub, BigInt(id));
  }
}
