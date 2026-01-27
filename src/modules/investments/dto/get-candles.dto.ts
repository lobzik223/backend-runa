import { IsString, IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum CandleInterval {
  ONE_MIN = '1_MIN',
  FIVE_MIN = '5_MIN',
  FIFTEEN_MIN = '15_MIN',
  HOUR = 'HOUR',
  DAY = 'DAY',
}

export class GetCandlesDto {
  @IsString()
  ticker!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsEnum(CandleInterval)
  @IsOptional()
  interval?: CandleInterval = CandleInterval.DAY;
}
