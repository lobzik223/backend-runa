import { IsNumber, IsOptional, IsDateString, IsString, Min } from 'class-validator';

export class AddGoalContributionDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

