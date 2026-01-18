import { Test, TestingModule } from '@nestjs/testing';
import { PushNotificationsService } from './push-notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { Platform } from './dto/update-push-token.dto';

describe('PushNotificationsService', () => {
  let service: PushNotificationsService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    device: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    scheduledEvent: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushNotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<PushNotificationsService>(PushNotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updatePushToken', () => {
    it('should create new device if not exists', async () => {
      const userId = 1;
      const dto = {
        deviceId: 'device-123',
        pushToken: 'fcm-token-123',
        platform: Platform.ANDROID,
      };

      mockPrisma.device.findUnique.mockResolvedValue(null);
      mockPrisma.device.create.mockResolvedValue({
        id: 'uuid-123',
        ...dto,
        userId,
      });

      const result = await service.updatePushToken(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.device.create).toHaveBeenCalled();
    });

    it('should update existing device', async () => {
      const userId = 1;
      const dto = {
        deviceId: 'device-123',
        pushToken: 'new-fcm-token',
      };

      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'uuid-123',
        deviceId: 'device-123',
        userId: 1,
      });
      mockPrisma.device.update.mockResolvedValue({
        id: 'uuid-123',
        ...dto,
        userId,
      });

      const result = await service.updatePushToken(userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.device.update).toHaveBeenCalled();
    });
  });

  describe('getUserPushTokens', () => {
    it('should return all active push tokens for user', async () => {
      const userId = 1;

      mockPrisma.device.findMany.mockResolvedValue([
        { pushToken: 'token-1', platform: 'ios' },
        { pushToken: 'token-2', platform: 'android' },
        { pushToken: null, platform: 'web' }, // Should be filtered out
      ]);

      const result = await service.getUserPushTokens(userId);

      expect(result).toHaveLength(2);
      expect(result[0]?.token).toBe('token-1');
      expect(result[1]?.token).toBe('token-2');
    });
  });

  describe('formatNotificationMessage', () => {
    it('should format credit payment message', () => {
      const message = (service as any).formatNotificationMessage('CREDIT_PAYMENT', 5000, 'RUB');
      expect(message).toContain('💳 Платёж по кредиту');
      expect(message).toContain('5'); // Check that amount is included
      expect(message).toContain('₽');
    });

    it('should format deposit interest message', () => {
      const message = (service as any).formatNotificationMessage('DEPOSIT_INTEREST', 416.67, 'RUB');
      expect(message).toContain('💰 Проценты по вкладу');
    });
  });

  describe('createIOSPayload', () => {
    it('should create iOS APNs payload', () => {
      const payload = service.createIOSPayload('Title', 'Body', { eventId: '123' });

      expect(payload.title).toBe('Title');
      expect(payload.body).toBe('Body');
      expect(payload.apns).toBeDefined();
      expect(payload.apns?.payload.aps.alert.title).toBe('Title');
      expect(payload.apns?.payload.aps.alert.body).toBe('Body');
    });
  });

  describe('createAndroidPayload', () => {
    it('should create Android FCM payload', () => {
      const payload = service.createAndroidPayload('Title', 'Body', { eventId: '123' });

      expect(payload.title).toBe('Title');
      expect(payload.body).toBe('Body');
      expect(payload.android).toBeDefined();
      expect(payload.android?.notification.title).toBe('Title');
      expect(payload.android?.notification.body).toBe('Body');
    });
  });
});
