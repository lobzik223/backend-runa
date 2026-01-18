import { Test, TestingModule } from '@nestjs/testing';
import { DepositAccountsService } from './deposit-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledEventsService } from '../scheduled-events/scheduled-events.service';
import { InterestCalculatorService } from '../scheduled-events/interest-calculator.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('DepositAccountsService', () => {
  let service: DepositAccountsService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    depositAccount: {
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
    upsertDepositInterestEvent: jest.fn(),
    deleteDepositAccountEvents: jest.fn(),
  };

  const mockInterestCalculator = {
    calculateDepositInterest: jest.fn(),
    calculateNextPayoutDate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositAccountsService,
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

    service = module.get<DepositAccountsService>(DepositAccountsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create deposit account and scheduled event', async () => {
      const userId = 1;
      const dto = {
        name: 'Savings Deposit',
        principal: 100000,
        interestRate: 5,
        nextPayoutAt: '2024-02-01',
      };

      mockInterestCalculator.calculateDepositInterest.mockReturnValue(416.67);
      mockPrisma.depositAccount.create.mockResolvedValue({
        id: 1,
        userId,
        ...dto,
        principal: 100000,
        interestRate: 5,
      });

      const result = await service.create(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockInterestCalculator.calculateDepositInterest).toHaveBeenCalledWith(100000, 5);
      expect(mockPrisma.scheduledEvent.create).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return deposit account', async () => {
      const userId = 1;
      const id = 1;

      mockPrisma.depositAccount.findUnique.mockResolvedValue({
        id,
        userId,
        name: 'Savings Deposit',
      });

      const result = await service.findOne(userId, id);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
    });

    it('should throw NotFoundException if account not found', async () => {
      const userId = 1;
      const id = 999;

      mockPrisma.depositAccount.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, id)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if account belongs to another user', async () => {
      const userId = 1;
      const id = 1;

      mockPrisma.depositAccount.findUnique.mockResolvedValue({
        id,
        userId: 2,
      });

      await expect(service.findOne(userId, id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update deposit account and reschedule event when APR changes', async () => {
      const userId = 1;
      const id = 1;
      const dto = {
        interestRate: 6, // Changed from 5 to 6
      };

      const existingAccount = {
        id,
        userId,
        name: 'Savings Deposit',
        principal: 100000,
        interestRate: 5,
        payoutSchedule: 'MONTHLY',
        nextPayoutAt: new Date('2024-02-01'),
        currency: 'RUB',
      };

      mockPrisma.depositAccount.findUnique.mockResolvedValue(existingAccount);
      mockInterestCalculator.calculateDepositInterest.mockReturnValue(500);
      mockPrisma.depositAccount.update.mockResolvedValue({
        ...existingAccount,
        interestRate: 6,
      });

      const result = await service.update(userId, id, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.scheduledEvent.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.scheduledEvent.create).toHaveBeenCalled();
      expect(mockInterestCalculator.calculateDepositInterest).toHaveBeenCalledWith(100000, 6);
    });
  });
});
