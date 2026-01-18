import { PinService } from './pin.service';

function createPrismaMock() {
  return {
    pinSecurity: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    phoneOtp: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('PinService', () => {
  test('setPin creates pin_security row', async () => {
    const prisma = createPrismaMock();
    prisma.pinSecurity.findUnique.mockResolvedValueOnce(null);

    const svc = new PinService(prisma as any);
    await svc.setPin(1, { pin: '1234', biometricEnabled: true, pinLength: 4 });

    expect(prisma.pinSecurity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, pinLength: 4, biometricEnabled: true }),
      }),
    );
  });

  test('verifyPin lockout after 5 wrong attempts', async () => {
    const prisma = createPrismaMock();
    prisma.pinSecurity.findUnique.mockResolvedValue({
      pinHash: '$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', // fake; verify will fail
      failedAttempts: 4,
      lockedUntil: null,
      pinLength: 4,
      biometricEnabled: false,
    });
    prisma.pinSecurity.update.mockResolvedValue({});

    const svc = new PinService(prisma as any);
    await expect(svc.verifyPin(1, '0000')).rejects.toBeDefined();

    // should update with lockedUntil set (since attempt #5)
    expect(prisma.pinSecurity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1 },
        data: expect.objectContaining({ failedAttempts: 5, lockedUntil: expect.any(Date) }),
      }),
    );
  });

  test('resetPin for email requires password (reject if missing)', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValueOnce({ email: 'a@b.com', phoneE164: null, passwordHash: 'hash' });

    const svc = new PinService(prisma as any);
    await expect(
      svc.resetPin(1, { newPin: '1234' } as any),
    ).rejects.toBeDefined();
  });
});

