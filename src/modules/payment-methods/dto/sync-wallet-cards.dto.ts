import { PaymentMethodType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WalletCardSyncItemDto {
  @IsString()
  @MaxLength(128)
  clientId!: string;

  @IsEnum(PaymentMethodType)
  @IsIn([PaymentMethodType.DEBIT_CARD, PaymentMethodType.CREDIT_CARD])
  type!: PaymentMethodType;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  last4?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  network?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  design?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverImageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  cardCurrency?: string;

  @IsOptional()
  @IsNumber()
  balance?: number;
}

export class SyncWalletCardsDto {
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => WalletCardSyncItemDto)
  cards!: WalletCardSyncItemDto[];
}
