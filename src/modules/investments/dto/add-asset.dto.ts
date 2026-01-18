import { IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { InvestmentAssetType } from '@prisma/client';

export class AddAssetDto {
  @IsString()
  @MinLength(1)
  tickerOrName!: string; // User can provide ticker (e.g., "AAPL") or name (e.g., "Apple")

  @IsEnum(InvestmentAssetType)
  @IsOptional()
  assetType?: InvestmentAssetType; // Optional hint for search

  @IsString()
  @IsOptional()
  exchange?: string; // Optional exchange hint (e.g., "NASDAQ", "MOEX")
}
