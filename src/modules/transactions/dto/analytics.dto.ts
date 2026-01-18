import { IsDateString, IsOptional, IsString } from 'class-validator';

export class AnalyticsDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  timezone?: string; // e.g., "Europe/Moscow"
}
