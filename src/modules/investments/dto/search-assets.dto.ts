import { InvestmentAssetType } from '@prisma/client';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const SEARCH_ASSET_TYPES = [
  'STOCK',
  'BOND',
  'ETF',
  'CRYPTO',
  'OTHER',
  'FUTURES',
] as const;

export type SearchAssetType = (typeof SEARCH_ASSET_TYPES)[number];

export class SearchAssetsDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @IsIn(SEARCH_ASSET_TYPES)
  assetType?: SearchAssetType;

  get assetTypeForProvider(): InvestmentAssetType | 'FUTURES' | undefined {
    if (!this.assetType) return undefined;
    return this.assetType;
  }
}
