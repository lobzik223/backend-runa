import { IsEnum, IsString, IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { CreditAccountKind } from '@prisma/client';

export class UpdateCreditAccountDto {
  @IsEnum(CreditAccountKind)
  @IsOptional()
  kind?: CreditAccountKind;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  principal?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  currentBalance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @IsNumber()
  @Min(1)
  @Max(31)
  @IsOptional()
  billingDay?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  interestRate?: number;

  @IsNumber()
  @Min(1)
  @Max(31)
  @IsOptional()
  paymentDay?: number;

  @IsDateString()
  @IsOptional()
  nextPaymentAt?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minimumPayment?: number;

  @IsDateString()
  @IsOptional()
  openedAt?: string;

  @IsDateString()
  @IsOptional()
  closedAt?: string;
}
