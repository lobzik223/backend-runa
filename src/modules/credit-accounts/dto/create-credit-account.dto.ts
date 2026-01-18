import { IsEnum, IsString, IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { CreditAccountKind } from '@prisma/client';

export class CreateCreditAccountDto {
  @IsEnum(CreditAccountKind)
  kind!: CreditAccountKind;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  // For LOAN
  @IsNumber()
  @Min(0)
  @IsOptional()
  principal?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  currentBalance?: number;

  // For CREDIT_CARD
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
  interestRate?: number; // APR as percentage

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
}
