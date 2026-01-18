import { IsString, IsNumber, IsOptional, IsDateString, IsEnum, Min, Max } from 'class-validator';
import { DepositPayoutSchedule } from '@prisma/client';

export class CreateDepositAccountDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0.01)
  principal!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  interestRate!: number; // APR as percentage

  @IsEnum(DepositPayoutSchedule)
  @IsOptional()
  payoutSchedule?: DepositPayoutSchedule;

  @IsDateString()
  @IsOptional()
  nextPayoutAt?: string; // Interest accrual date

  @IsDateString()
  @IsOptional()
  maturityAt?: string;
}
