import { Test, TestingModule } from '@nestjs/testing';
import { CreditAccountsService } from './credit-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledEventsService } from '../scheduled-events/scheduled-events.service';
import { InterestCalculatorService } from '../scheduled-events/interest-calculator.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('CreditAccountsService', () => {
  let service: CreditAccountsService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    creditAccount: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    scheduledEvent: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrisma)),
  };

  const mockScheduledEventsService = {
    upsertCreditPaymentEvent: jest.fn(),
    deleteCreditAccountEvents: jest.fn(),
  };

  const mockInterestCalculator = {
    calculateLoanPayment: jest.fn(),
    calculateLoanInterest: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditAccountsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ScheduledEventsService,
          useValue: mockScheduledEventsService,
        },
        {
          provide: InterestCalculatorService,
          useValue: mockInterestCalculator,
        },
      ],
    }).compile();

    service = module.get<CreditAccountsService>(CreditAccountsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a credit account successfully', async () => {
      const userId = 1;
      const dto = {
        kind: 'CREDIT_CARD' as const,
        name: 'Visa Card',
        creditLimit: 100000,
        currentBalance: 5000,
        interestRate: 12.5,
      };

      mockPrisma.creditAccount.create.mockResolvedValue({
        id: 1,
        userId,
        ...dto,
      });

      const result = await service.create(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should create scheduled event for LOAN with APR', async () => {
      const userId = 1;
      const dto = {
        kind: 'LOAN' as const,
        name: 'Personal Loan',
        currentBalance: 100000,
        interestRate: 12,
        nextPaymentAt: '2024-02-01',
        minimumPayment: 5000,
      };

      mockInterestCalculator.calculateLoanPayment.mockReturnValue(6000);
      mockPrisma.creditAccount.create.mockResolvedValue({
        id: 1,
        userId,
        ...dto,
      });

      const result = await service.create(userId, dto);

      expect(result).toBeDefined();
      expect(mockInterestCalculator.calculateLoanPayment).toHaveBeenCalledWith(100000, 12, 5000);
      expect(mockPrisma.scheduledEvent.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if currentBalance exceeds creditLimit', async () => {
      const userId = 1;
      const dto = {
        kind: 'CREDIT_CARD' as const,
        name: 'Visa Card',
        creditLimit: 10000,
        currentBalance: 15000, // Exceeds limit
      };

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return a credit account', async () => {
      const userId = 1;
      const id = 1;

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        id,
        userId,
        name: 'Visa Card',
      });

      const result = await service.findOne(userId, id);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
    });

    it('should throw NotFoundException if account not found', async () => {
      const userId = 1;
      const id = 999;

      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, id)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if account belongs to another user', async () => {
      const userId = 1;
      const id = 1;

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        id,
        userId: 2,
      });

      await expect(service.findOne(userId, id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update loan and reschedule payment event when APR changes', async () => {
      const userId = 1;
      const id = 1;
      const dto = {
        interestRate: 15, // Changed from 12 to 15
      };

      const existingAccount = {
        id,
        userId,
        kind: 'LOAN' as const,
        name: 'Personal Loan',
        currentBalance: 100000,
        interestRate: 12,
        nextPaymentAt: new Date('2024-02-01'),
        minimumPayment: 5000,
        currency: 'RUB',
        creditLimit: null,
      };

      mockPrisma.creditAccount.findUnique.mockResolvedValue(existingAccount);
      mockInterestCalculator.calculateLoanPayment.mockReturnValue(6250);
      mockPrisma.creditAccount.update.mockResolvedValue({
        ...existingAccount,
        interestRate: 15,
      });

      const result = await service.update(userId, id, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.scheduledEvent.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.scheduledEvent.create).toHaveBeenCalled();
      expect(mockInterestCalculator.calculateLoanPayment).toHaveBeenCalledWith(100000, 15, 5000);
    });
  });

  describe('updateDebtAtomic', () => {
    it('should increase debt successfully', async () => {
      const creditAccountId = 1;
      const delta = 1000;

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        id: creditAccountId,
        currentBalance: 5000,
      });

      mockPrisma.creditAccount.update.mockResolvedValue({
        id: creditAccountId,
        currentBalance: 6000,
      });

      await service.updateDebtAtomic(creditAccountId, delta);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith({
        where: { id: creditAccountId },
        data: { currentBalance: 6000 },
      });
    });

    it('should decrease debt successfully', async () => {
      const creditAccountId = 1;
      const delta = -1000;

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        id: creditAccountId,
        currentBalance: 5000,
      });

      mockPrisma.creditAccount.update.mockResolvedValue({
        id: creditAccountId,
        currentBalance: 4000,
      });

      await service.updateDebtAtomic(creditAccountId, delta);

      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith({
        where: { id: creditAccountId },
        data: { currentBalance: 4000 },
      });
    });

    it('should throw BadRequestException if debt would go negative', async () => {
      const creditAccountId = 1;
      const delta = -6000; // Would make balance negative

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        id: creditAccountId,
        currentBalance: 5000,
      });

      await expect(service.updateDebtAtomic(creditAccountId, delta)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if account not found', async () => {
      const creditAccountId = 999;
      const delta = 1000;

      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      await expect(service.updateDebtAtomic(creditAccountId, delta)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
