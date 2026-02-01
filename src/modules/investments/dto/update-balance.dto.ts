import { IsNumber, Min, Max } from 'class-validator';

/** Максимальный доступный баланс инвестиционного счёта (1 трлн ₽) */
export const MAX_INVESTMENT_BALANCE = 1_000_000_000_000;

export class UpdateBalanceDto {
  @IsNumber()
  @Min(0, { message: 'Баланс не может быть отрицательным' })
  @Max(MAX_INVESTMENT_BALANCE, { message: `Баланс не может превышать ${MAX_INVESTMENT_BALANCE.toLocaleString('ru-RU')} ₽` })
  balance!: number;
}
