import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** Максимальное суммарное пополнение за календарный день по одной валюте (МСК). */
export const DAILY_INVESTMENT_TOP_UP_LIMIT = 100_000_000;

export class TopUpInvestmentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Минимальная сумма пополнения — 0,01' })
  @Max(DAILY_INVESTMENT_TOP_UP_LIMIT, {
    message: `За операцию недоступно больше ${DAILY_INVESTMENT_TOP_UP_LIMIT.toLocaleString('ru-RU')}`,
  })
  amount!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/i, {
    message: 'Код валюты: три латинские буквы (напр. RUB)',
  })
  currency?: string;
}
