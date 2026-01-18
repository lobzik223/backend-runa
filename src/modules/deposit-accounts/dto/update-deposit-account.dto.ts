import { IsString, IsNumber, IsOptional, IsDateString, IsEnum, Min, Max } from 'class-validator';
import { DepositPayoutSchedule } from '@prisma/client';

export class UpdateDepositAccountDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  principal?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  interestRate?: number;

  @IsEnum(DepositPayoutSchedule)
  @IsOptional()
  payoutSchedule?: DepositPayoutSchedule;

  @IsDateString()
  @IsOptional()
  nextPayoutAt?: string;

  @IsDateString()
  @IsOptional()
  maturityAt?: string;
}
