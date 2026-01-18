import { Injectable } from '@nestjs/common';

/**
 * Service for calculating interest and payment amounts.
 * Uses simple interest formula: Interest = Principal × (APR / 100) / 12
 *
 * Assumptions:
 * - Monthly compounding (simple interest)
 * - APR is annual percentage rate
 * - Calculations are per month
 */
@Injectable()
export class InterestCalculatorService {
  /**
   * Calculate monthly interest for a loan payment.
   * Formula: Interest = CurrentBalance × (APR / 100) / 12
   *
   * @param currentBalance Current debt balance
   * @param apr Annual percentage rate (e.g., 12.5 for 12.5%)
   * @returns Monthly interest amount
   */
  calculateLoanInterest(currentBalance: number, apr: number): number {
    if (currentBalance <= 0 || apr < 0) {
      return 0;
    }
    return (currentBalance * (apr / 100)) / 12;
  }

  /**
   * Calculate total loan payment (interest + minimum payment).
   * If minimumPayment is provided, total = interest + minimumPayment.
   * Otherwise, total = interest only (interest-only payment).
   *
   * @param currentBalance Current debt balance
   * @param apr Annual percentage rate
   * @param minimumPayment Optional minimum payment amount
   * @returns Total payment amount
   */
  calculateLoanPayment(currentBalance: number, apr: number, minimumPayment?: number | null): number {
    const interest = this.calculateLoanInterest(currentBalance, apr);
    if (minimumPayment && minimumPayment > 0) {
      return interest + minimumPayment;
    }
    return interest; // Interest-only payment
  }

  /**
   * Calculate monthly interest for a deposit account.
   * Formula: Interest = Principal × (APR / 100) / 12
   *
   * @param principal Deposit principal amount
   * @param apr Annual percentage rate (e.g., 5.0 for 5%)
   * @returns Monthly interest amount
   */
  calculateDepositInterest(principal: number, apr: number): number {
    if (principal <= 0 || apr < 0) {
      return 0;
    }
    return (principal * (apr / 100)) / 12;
  }

  /**
   * Calculate next payment date (one month from given date).
   *
   * @param baseDate Base date
   * @returns Date one month later
   */
  calculateNextPaymentDate(baseDate: Date): Date {
    const next = new Date(baseDate);
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  /**
   * Calculate next payout date based on schedule.
   *
   * @param baseDate Base date
   * @param schedule Payout schedule (MONTHLY, QUARTERLY, etc.)
   * @returns Next payout date
   */
  calculateNextPayoutDate(baseDate: Date, schedule: string): Date {
    const next = new Date(baseDate);
    switch (schedule) {
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'AT_MATURITY':
        // For AT_MATURITY, return the maturity date itself (should be set separately)
        return baseDate;
      default:
        // Default to monthly
        next.setMonth(next.getMonth() + 1);
    }
    return next;
  }
}
