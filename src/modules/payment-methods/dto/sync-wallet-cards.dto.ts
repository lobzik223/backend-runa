import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'Стабильный id карты на клиенте' })
  @IsString()
  @MaxLength(128)
  clientId!: string;

  @ApiProperty({ enum: ['DEBIT_CARD', 'CREDIT_CARD'] })
  @IsEnum(PaymentMethodType)
  @IsIn([PaymentMethodType.DEBIT_CARD, PaymentMethodType.CREDIT_CARD])
  type!: PaymentMethodType;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  last4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  network?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  design?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverImageKey?: string;

  @ApiPropertyOptional({ example: 'RUB' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  cardCurrency?: string;

  @ApiPropertyOptional({ description: 'Текущий демо-баланс' })
  @IsOptional()
  @IsNumber()
  balance?: number;
}

export class SyncWalletCardsDto {
  @ApiProperty({ type: [WalletCardSyncItemDto] })
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => WalletCardSyncItemDto)
  cards!: WalletCardSyncItemDto[];
}
