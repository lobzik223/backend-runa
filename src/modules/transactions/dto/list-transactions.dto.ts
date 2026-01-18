import { IsEnum, IsNumber, IsOptional, IsDateString, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType } from '@prisma/client';

export class ListTransactionsDto {
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  categoryId?: number;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  paymentMethodId?: number;

  @IsString()
  @IsOptional()
  timezone?: string; // e.g., "Europe/Moscow"

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
