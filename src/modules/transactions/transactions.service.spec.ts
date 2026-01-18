import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: PrismaService;
  let creditAccountsService: CreditAccountsService;

  const mockPrisma: any = {
    transaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
    paymentMethod: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrisma)),
  };

  const mockCreditAccountsService = {
    updateDebtAtomic: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CreditAccountsService,
          useValue: mockCreditAccountsService,
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    creditAccountsService = module.get<CreditAccountsService>(CreditAccountsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a transaction successfully', async () => {
      const userId = 1;
      const dto = {
        type: TransactionType.EXPENSE,
        amount: 1000,
        currency: 'RUB',
        occurredAt: '2024-01-15T10:00:00Z',
        note: 'Test transaction',
        categoryId: 1,
        paymentMethodId: 1,
      };

      mockPrisma.category.findUnique.mockResolvedValue({
        id: 1,
        userId: null,
        type: TransactionType.EXPENSE,
      });
      mockPrisma.paymentMethod.findUnique.mockResolvedValue({
        id: 1,
        userId: null,
        creditAccountId: null,
        creditAccount: null,
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: BigInt(1),
        ...dto,
        userId,
        category: { id: 1, name: 'Test Category' },
        paymentMethod: { id: 1, name: 'Cash', creditAccount: null },
      });

      const result = await service.create(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockCreditAccountsService.updateDebtAtomic).not.toHaveBeenCalled();
    });

    it('should update credit account debt when creating expense with credit card', async () => {
      const userId = 1;
      const dto = {
        type: TransactionType.EXPENSE,
        amount: 1000,
        currency: 'RUB',
        occurredAt: '2024-01-15T10:00:00Z',
        paymentMethodId: 1,
      };

      mockPrisma.category.findUnique.mockResolvedValue({
        id: 1,
        userId: null,
        type: TransactionType.EXPENSE,
      });
      // First call: validation
      mockPrisma.paymentMethod.findUnique
        .mockResolvedValueOnce({
          id: 1,
          userId: null, // System payment method
          creditAccountId: 1,
          creditAccount: { id: 1 },
        })
        // Second call: fetch updated payment method after transaction
        .mockResolvedValueOnce({
          id: 1,
          creditAccountId: 1,
          creditAccount: { id: 1, currentBalance: 1000 },
        });
      mockPrisma.transaction.create.mockResolvedValue({
        id: BigInt(1),
        ...dto,
        userId,
        category: { id: 1, name: 'Test Category' },
        paymentMethod: { id: 1, name: 'Credit Card', creditAccountId: 1, creditAccount: { id: 1 } },
      });

      const result = await service.create(userId, dto);

      expect(result).toBeDefined();
      expect(mockCreditAccountsService.updateDebtAtomic).toHaveBeenCalledWith(1, 1000);
    });

    it('should throw NotFoundException if category not found', async () => {
      const userId = 1;
      const dto = {
        type: TransactionType.EXPENSE,
        amount: 1000,
        occurredAt: '2024-01-15T10:00:00Z',
        categoryId: 999,
      };

      mockPrisma.category.findUnique.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if category type mismatch', async () => {
      const userId = 1;
      const dto = {
        type: TransactionType.EXPENSE,
        amount: 1000,
        occurredAt: '2024-01-15T10:00:00Z',
        categoryId: 1,
      };

      mockPrisma.category.findUnique.mockResolvedValue({
        id: 1,
        userId: null,
        type: TransactionType.INCOME,
      });

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return paginated transactions', async () => {
      const userId = 1;
      const dto = {
        page: 1,
        limit: 20,
        timezone: 'Europe/Moscow',
      };

      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: BigInt(1),
          type: TransactionType.EXPENSE,
          amount: 1000,
          category: { id: 1, name: 'Test' },
          paymentMethod: { id: 1, name: 'Cash' },
        },
      ]);
      mockPrisma.transaction.count.mockResolvedValue(1);

      const result = await service.findAll(userId, dto);

      expect(result.data).toBeDefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return a transaction', async () => {
      const userId = 1;
      const id = BigInt(1);

      mockPrisma.transaction.findUnique.mockResolvedValue({
        id,
        userId,
        type: TransactionType.EXPENSE,
        amount: 1000,
      });

      const result = await service.findOne(userId, id);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
    });

    it('should throw NotFoundException if transaction not found', async () => {
      const userId = 1;
      const id = BigInt(999);

      mockPrisma.transaction.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, id)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if transaction belongs to another user', async () => {
      const userId = 1;
      const id = BigInt(1);

      mockPrisma.transaction.findUnique.mockResolvedValue({
        id,
        userId: 2,
      });

      await expect(service.findOne(userId, id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics with donut chart data', async () => {
      const userId = 1;
      const dto = {
        from: '2024-01-01',
        to: '2024-01-31',
        timezone: 'Europe/Moscow',
      };

      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 50000 } }) // income
        .mockResolvedValueOnce({ _sum: { amount: 20000 } }); // expense

      mockPrisma.transaction.findMany
        .mockResolvedValueOnce([
          {
            id: BigInt(1),
            type: TransactionType.INCOME,
            amount: 50000,
            categoryId: 1,
            category: { id: 1, name: 'Зарплата' },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: BigInt(2),
            type: TransactionType.EXPENSE,
            amount: 20000,
            categoryId: 2,
            category: { id: 2, name: 'Продукты' },
          },
        ]);

      const result = await service.getAnalytics(userId, dto);

      expect(result.totals).toBeDefined();
      expect(result.totals.income).toBe(50000);
      expect(result.totals.expense).toBe(20000);
      expect(result.donutChart).toBeDefined();
      expect(result.donutChart.incomePercent).toBeGreaterThan(0);
      expect(result.donutChart.expensePercent).toBeGreaterThan(0);
      expect(result.breakdown.income).toBeDefined();
      expect(result.breakdown.expense).toBeDefined();
    });
  });

  describe('update', () => {
    it('should rollback and update debt when changing expense amount with credit card', async () => {
      const userId = 1;
      const id = BigInt(1);
      const dto = {
        amount: 2000, // Changed from 1000 to 2000
      };

      const oldTransaction = {
        id,
        userId,
        type: TransactionType.EXPENSE,
        amount: 1000,
        paymentMethodId: 1,
        paymentMethod: {
          id: 1,
          creditAccountId: 1,
          creditAccount: { id: 1 },
        },
      };

      mockPrisma.transaction.findUnique
        .mockResolvedValueOnce(oldTransaction) // findOne call
        .mockResolvedValueOnce(oldTransaction); // findOne in update

      mockPrisma.paymentMethod.findUnique.mockResolvedValue({
        id: 1,
        creditAccountId: 1,
        creditAccount: { id: 1 },
      });

      mockPrisma.transaction.update.mockResolvedValue({
        ...oldTransaction,
        amount: 2000,
      });

      await service.update(userId, id, dto);

      // Should rollback old amount (-1000) and add new amount (+2000)
      expect(mockCreditAccountsService.updateDebtAtomic).toHaveBeenCalledWith(1, -1000);
      expect(mockCreditAccountsService.updateDebtAtomic).toHaveBeenCalledWith(1, 2000);
    });
  });

  describe('remove', () => {
    it('should rollback debt when deleting expense with credit card', async () => {
      const userId = 1;
      const id = BigInt(1);

      const transaction = {
        id,
        userId,
        type: TransactionType.EXPENSE,
        amount: 1000,
        paymentMethodId: 1,
        paymentMethod: {
          id: 1,
          creditAccountId: 1,
          creditAccount: { id: 1 },
        },
      };

      mockPrisma.transaction.findUnique.mockResolvedValue(transaction);
      mockPrisma.paymentMethod.findUnique.mockResolvedValue({
        id: 1,
        creditAccountId: 1,
        creditAccount: { id: 1 },
      });
      mockPrisma.transaction.delete.mockResolvedValue(transaction);

      await service.remove(userId, id);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockCreditAccountsService.updateDebtAtomic).toHaveBeenCalledWith(1, -1000);
    });

    it('should not update debt when deleting income transaction', async () => {
      const userId = 1;
      const id = BigInt(1);

      const transaction = {
        id,
        userId,
        type: TransactionType.INCOME,
        amount: 1000,
        paymentMethodId: 1,
        paymentMethod: {
          id: 1,
          creditAccountId: 1,
          creditAccount: { id: 1 },
        },
      };

      mockPrisma.transaction.findUnique.mockResolvedValue(transaction);
      mockPrisma.transaction.delete.mockResolvedValue(transaction);

      await service.remove(userId, id);

      expect(mockCreditAccountsService.updateDebtAtomic).not.toHaveBeenCalled();
    });
  });
});
