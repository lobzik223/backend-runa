import { IsInt, IsString, Min, MinLength, Max, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePromoDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(2, { message: 'Код не менее 2 символов' })
  code!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Укажите название' })
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsIn(['RUB', 'PERCENT'], { message: 'Тип скидки: RUB или PERCENT' })
  discountType!: string;

  @Transform(({ value }) => (value !== undefined && value !== '' ? Number(value) : value))
  @IsInt()
  @Min(0)
  @Max(100)
  discountValue!: number;

  @IsString()
  validUntil!: string; // ISO date
}
