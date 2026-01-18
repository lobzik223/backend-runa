import { Test, TestingModule } from '@nestjs/testing';
import { InterestCalculatorService } from './interest-calculator.service';

describe('InterestCalculatorService', () => {
  let service: InterestCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InterestCalculatorService],
    }).compile();

    service = module.get<InterestCalculatorService>(InterestCalculatorService);
  });

  describe('calculateLoanInterest', () => {
    it('should calculate monthly interest correctly', () => {
      // 12% APR on 100,000 balance
      // Monthly interest = 100,000 * (12 / 100) / 12 = 1,000
      const result = service.calculateLoanInterest(100000, 12);
      expect(result).toBe(1000);
    });

    it('should return 0 for zero balance', () => {
      const result = service.calculateLoanInterest(0, 12);
      expect(result).toBe(0);
    });

    it('should return 0 for negative APR', () => {
      const result = service.calculateLoanInterest(100000, -5);
      expect(result).toBe(0);
    });

    it('should handle decimal APR', () => {
      // 12.5% APR on 100,000 balance
      // Monthly interest = 100,000 * (12.5 / 100) / 12 = 1,041.67
      const result = service.calculateLoanInterest(100000, 12.5);
      expect(result).toBeCloseTo(1041.67, 2);
    });
  });

  describe('calculateLoanPayment', () => {
    it('should calculate payment with minimum payment', () => {
      // Interest = 1,000, minimum = 5,000
      // Total = 6,000
      const result = service.calculateLoanPayment(100000, 12, 5000);
      expect(result).toBe(6000);
    });

    it('should return interest only if no minimum payment', () => {
      const result = service.calculateLoanPayment(100000, 12, null);
      expect(result).toBe(1000);
    });

    it('should return interest only if minimum payment is 0', () => {
      const result = service.calculateLoanPayment(100000, 12, 0);
      expect(result).toBe(1000);
    });
  });

  describe('calculateDepositInterest', () => {
    it('should calculate monthly interest correctly', () => {
      // 5% APR on 100,000 principal
      // Monthly interest = 100,000 * (5 / 100) / 12 = 416.67
      const result = service.calculateDepositInterest(100000, 5);
      expect(result).toBeCloseTo(416.67, 2);
    });

    it('should return 0 for zero principal', () => {
      const result = service.calculateDepositInterest(0, 5);
      expect(result).toBe(0);
    });

    it('should return 0 for negative APR', () => {
      const result = service.calculateDepositInterest(100000, -5);
      expect(result).toBe(0);
    });
  });

  describe('calculateNextPaymentDate', () => {
    it('should add one month to date', () => {
      const baseDate = new Date('2024-01-15');
      const result = service.calculateNextPaymentDate(baseDate);
      expect(result.getMonth()).toBe(1); // February (0-indexed)
      expect(result.getFullYear()).toBe(2024);
    });

    it('should handle year rollover', () => {
      const baseDate = new Date('2024-12-15');
      const result = service.calculateNextPaymentDate(baseDate);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getFullYear()).toBe(2025);
    });
  });

  describe('calculateNextPayoutDate', () => {
    it('should add one month for MONTHLY schedule', () => {
      const baseDate = new Date('2024-01-15');
      const result = service.calculateNextPayoutDate(baseDate, 'MONTHLY');
      expect(result.getMonth()).toBe(1);
    });

    it('should add three months for QUARTERLY schedule', () => {
      const baseDate = new Date('2024-01-15');
      const result = service.calculateNextPayoutDate(baseDate, 'QUARTERLY');
      expect(result.getMonth()).toBe(3); // April
    });

    it('should return same date for AT_MATURITY', () => {
      const baseDate = new Date('2024-12-31');
      const result = service.calculateNextPayoutDate(baseDate, 'AT_MATURITY');
      expect(result).toEqual(baseDate);
    });
  });
});
