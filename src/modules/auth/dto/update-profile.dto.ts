import { IsOptional, IsString, MaxLength, MinLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(15)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(14)
  @Max(120)
  profileAge?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  financePurpose?: string;
}
