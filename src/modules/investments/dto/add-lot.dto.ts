import { IsInt, IsNumber, IsDateString, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddLotDto {
  @IsInt()
  assetId!: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  @Type(() => Number)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Type(() => Number)
  pricePerUnit!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  fees?: number;

  @IsDateString()
  boughtAt!: string; // ISO date string
}
