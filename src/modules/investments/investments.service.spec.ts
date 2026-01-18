import { Test, TestingModule } from '@nestjs/testing';
import { InvestmentsService } from './investments.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataProvider } from './interfaces/market-data-provider.interface';
import { AddAssetDto } from './dto/add-asset.dto';
import { AddLotDto } from './dto/add-lot.dto';

describe('InvestmentsService', () => {
  let service: InvestmentsService;
  let prisma: PrismaService;
  let marketDataProvider: MarketDataProvider;

  const mockPrisma: any = {
    investmentAsset: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    investmentLot: {
      create: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockMarketDataProvider: any = {
    getCurrentPrice: jest.fn(),
    searchAssets: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: 'MarketDataProvider',
          useValue: mockMarketDataProvider,
        } as any,
      ],
    }).compile();

    service = module.get<InvestmentsService>(InvestmentsService);
    prisma = module.get<PrismaService>(PrismaService);
    marketDataProvider = module.get<MarketDataProvider>('MarketDataProvider');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addAsset', () => {
    const userId = 1;

    it('should create asset from market data when exact ticker match found', async () => {
      const dto: AddAssetDto = {
        tickerOrName: 'AAPL',
        assetType: 'STOCK',
      };

      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(175.50);
      mockMarketDataProvider.searchAssets.mockResolvedValue([
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          type: 'STOCK',
          currency: 'USD',
          exchange: 'NASDAQ',
        },
      ]);
      mockPrisma.investmentAsset.findUnique.mockResolvedValue(null);
      mockPrisma.investmentAsset.create.mockResolvedValue({
        id: 1,
        userId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetType: 'STOCK',
        currency: 'USD',
        exchange: 'NASDAQ',
      });

      const result = await service.addAsset(userId, dto);

      expect(result).toBeDefined();
      expect(result.symbol).toBe('AAPL');
      expect(mockPrisma.investmentAsset.create).toHaveBeenCalled();
    });

    it('should return existing asset if already exists', async () => {
      const dto: AddAssetDto = {
        tickerOrName: 'AAPL',
      };

      const existingAsset = {
        id: 1,
        userId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetType: 'STOCK',
        currency: 'USD',
      };

      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(175.50);
      mockMarketDataProvider.searchAssets.mockResolvedValue([
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          type: 'STOCK',
          currency: 'USD',
        },
      ]);
      mockPrisma.investmentAsset.findUnique.mockResolvedValue(existingAsset);

      const result = await service.addAsset(userId, dto);

      expect(result).toEqual(existingAsset);
      expect(mockPrisma.investmentAsset.create).not.toHaveBeenCalled();
    });

    it('should create user-entered asset when no market data found', async () => {
      const dto: AddAssetDto = {
        tickerOrName: 'CUSTOM',
      };

      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(null);
      mockMarketDataProvider.searchAssets.mockResolvedValue([]);
      mockPrisma.investmentAsset.findUnique.mockResolvedValue(null);
      mockPrisma.investmentAsset.create.mockResolvedValue({
        id: 1,
        userId,
        symbol: 'CUSTOM',
        name: 'CUSTOM',
        assetType: 'OTHER',
        currency: 'RUB',
      });

      const result = await service.addAsset(userId, dto);

      expect(result).toBeDefined();
      expect(result.symbol).toBe('CUSTOM');
      expect(mockPrisma.investmentAsset.create).toHaveBeenCalled();
    });

    it('should throw error when multiple assets found', async () => {
      const dto: AddAssetDto = {
        tickerOrName: 'APPLE',
      };

      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(null);
      mockMarketDataProvider.searchAssets.mockResolvedValue([
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          type: 'STOCK',
          currency: 'USD',
        },
        {
          symbol: 'APLE',
          name: 'Apple Hospitality REIT',
          type: 'STOCK',
          currency: 'USD',
        },
      ]);

      await expect(service.addAsset(userId, dto)).rejects.toThrow('Multiple assets found');
    });
  });

  describe('addLot', () => {
    const userId = 1;
    const assetId = 1;

    it('should create lot successfully', async () => {
      const dto: AddLotDto = {
        assetId,
        quantity: 10,
        pricePerUnit: 150.50,
        fees: 5.00,
        boughtAt: '2024-01-15T10:00:00Z',
      };

      mockPrisma.investmentAsset.findUnique.mockResolvedValue({
        id: assetId,
        userId,
        symbol: 'AAPL',
      });
      mockPrisma.investmentLot.create.mockResolvedValue({
        id: BigInt(1),
        ...dto,
        userId,
      });

      const result = await service.addLot(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.investmentLot.create).toHaveBeenCalled();
    });

    it('should throw error if asset not found', async () => {
      const dto: AddLotDto = {
        assetId: 999,
        quantity: 10,
        pricePerUnit: 150.50,
        boughtAt: '2024-01-15T10:00:00Z',
      };

      mockPrisma.investmentAsset.findUnique.mockResolvedValue(null);

      await expect(service.addLot(userId, dto)).rejects.toThrow('Asset not found');
    });

    it('should throw error if asset does not belong to user', async () => {
      const dto: AddLotDto = {
        assetId,
        quantity: 10,
        pricePerUnit: 150.50,
        boughtAt: '2024-01-15T10:00:00Z',
      };

      mockPrisma.investmentAsset.findUnique.mockResolvedValue({
        id: assetId,
        userId: 999, // Different user
      });

      await expect(service.addLot(userId, dto)).rejects.toThrow('Asset does not belong to user');
    });
  });

  describe('getPortfolio', () => {
    const userId = 1;

    it('should calculate portfolio metrics correctly', async () => {
      const assets = [
        {
          id: 1,
          symbol: 'AAPL',
          name: 'Apple Inc.',
          assetType: 'STOCK',
          currency: 'USD',
          exchange: 'NASDAQ',
          lots: [
            {
              quantity: 10,
              pricePerUnit: 150.00,
              fees: 5.00,
            },
            {
              quantity: 5,
              pricePerUnit: 160.00,
              fees: 3.00,
            },
          ],
        },
      ];

      mockPrisma.investmentAsset.findMany.mockResolvedValue(assets);
      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(175.50);

      const result = await service.getPortfolio(userId);

      expect(result).toBeDefined();
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]?.symbol).toBe('AAPL');
      expect(result.assets[0]?.totalQuantity).toBe(15); // 10 + 5
      expect(result.assets[0]?.totalCost).toBe(2408.00); // (10 * 150 + 5) + (5 * 160 + 3)
      expect(result.assets[0]?.currentValue).toBe(2632.50); // 15 * 175.50
      expect(result.assets[0]?.pnlValue).toBe(224.50); // 2632.50 - 2408.00
      expect(result.totalCost).toBe(2408.00);
      expect(result.totalCurrentValue).toBe(2632.50);
      expect(result.totalPnlValue).toBe(224.50);
    });

    it('should handle assets with no current price', async () => {
      const assets = [
        {
          id: 1,
          symbol: 'CUSTOM',
          name: 'Custom Asset',
          assetType: 'OTHER',
          currency: 'RUB',
          exchange: null,
          lots: [
            {
              quantity: 100,
              pricePerUnit: 10.00,
              fees: 0,
            },
          ],
        },
      ];

      mockPrisma.investmentAsset.findMany.mockResolvedValue(assets);
      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(null);

      const result = await service.getPortfolio(userId);

      expect(result.assets[0]?.currentValue).toBeNull();
      expect(result.assets[0]?.pnlValue).toBeNull();
      expect(result.assets[0]?.pnlPercent).toBeNull();
      expect(result.totalCurrentValue).toBeNull();
      expect(result.totalPnlValue).toBeNull();
    });

    it('should handle assets with no lots', async () => {
      const assets = [
        {
          id: 1,
          symbol: 'AAPL',
          name: 'Apple Inc.',
          assetType: 'STOCK',
          currency: 'USD',
          exchange: 'NASDAQ',
          lots: [],
        },
      ];

      mockPrisma.investmentAsset.findMany.mockResolvedValue(assets);
      mockMarketDataProvider.getCurrentPrice.mockResolvedValue(175.50);

      const result = await service.getPortfolio(userId);

      expect(result.assets[0]?.totalQuantity).toBe(0);
      expect(result.assets[0]?.totalCost).toBe(0);
      expect(result.assets[0]?.currentValue).toBeNull();
    });
  });

  describe('listAssets', () => {
    const userId = 1;

    it('should return all user assets', async () => {
      const assets = [
        {
          id: 1,
          symbol: 'AAPL',
          name: 'Apple Inc.',
          userId,
        },
        {
          id: 2,
          symbol: 'GOOGL',
          name: 'Alphabet Inc.',
          userId,
        },
      ];

      mockPrisma.investmentAsset.findMany.mockResolvedValue(assets);

      const result = await service.listAssets(userId);

      expect(result).toEqual(assets);
      expect(mockPrisma.investmentAsset.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: {
          _count: {
            select: {
              lots: {
                where: {
                  soldAt: null,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('deleteAsset', () => {
    const userId = 1;
    const assetId = 1;

    it('should delete asset if no lots exist', async () => {
      mockPrisma.investmentAsset.findUnique.mockResolvedValue({
        id: assetId,
        userId,
        symbol: 'AAPL',
      });
      mockPrisma.investmentLot.count.mockResolvedValue(0);
      mockPrisma.investmentAsset.delete.mockResolvedValue({ id: assetId });

      await service.deleteAsset(userId, assetId);

      expect(mockPrisma.investmentAsset.delete).toHaveBeenCalled();
    });

    it('should throw error if asset has lots', async () => {
      mockPrisma.investmentAsset.findUnique.mockResolvedValue({
        id: assetId,
        userId,
        symbol: 'AAPL',
      });
      mockPrisma.investmentLot.count.mockResolvedValue(5);

      await expect(service.deleteAsset(userId, assetId)).rejects.toThrow(
        'Cannot delete asset with existing lots',
      );
    });
  });
});
