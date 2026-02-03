import { AuthService } from './auth.service';

function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    referralCode: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    referralRedemption: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    device: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
    phoneOtp: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
}

function createJwtMock() {
  return {
    signAsync: jest.fn(async () => 'jwt-token'),
  };
}

function createSmsMock() {
  return { sendOtp: jest.fn(async () => undefined) };
}

function createEmailMock() {
  return { sendVerificationCode: jest.fn(async () => undefined) };
}

function createEntitlementsMock() {
  return { grantPremium: jest.fn(async () => undefined) };
}

describe('AuthService (referral + OTP)', () => {
  test('email register: valid referral => both get 7 days premium', async () => {
    const prisma = createPrismaMock();
    const jwt = createJwtMock();
    const sms = createSmsMock();
    const entitlements = createEntitlementsMock();

    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce({ id: 10, email: 'a@b.com', name: 'A', createdAt: new Date() });

    prisma.referralCode.findUnique
      .mockResolvedValueOnce(null) // ensureUserReferralCode(userId=10): not exists
      .mockResolvedValueOnce({ id: 'rc1', userId: 1 }); // lookup referral code by code

    prisma.referralCode.create.mockResolvedValueOnce({ id: 'x', userId: 10, code: 'RUNA1234' });
    prisma.referralRedemption.findFirst.mockResolvedValueOnce(null); // код ещё не использован
    prisma.referralRedemption.findUnique.mockResolvedValueOnce(null); // invitee ещё не использовал промокод
    prisma.device.findFirst.mockResolvedValueOnce(null);
    prisma.referralRedemption.count.mockResolvedValueOnce(0);
    prisma.referralRedemption.create.mockResolvedValueOnce({ id: 'rr1' });
    prisma.user.findUnique
      .mockResolvedValueOnce({ trialUntil: null, premiumUntil: null }) // inviter без доступа
      .mockResolvedValueOnce({ id: 10, email: 'a@b.com', name: 'A', createdAt: new Date(), trialUntil: null, premiumUntil: new Date() }); // ответ с premiumUntil

    const svc = new AuthService(prisma as any, jwt as any, sms as any, createEmailMock() as any, entitlements as any);

    const res = await svc.register({
      name: 'A',
      email: 'a@b.com',
      password: 'password123',
      referralCode: 'RUNA_INVITER',
      deviceId: 'device-1',
      ip: '1.1.1.1',
      userAgent: 'ua',
    });

    expect(res.token).toBeDefined();
    expect(res.referralApplied).toBe(true);
    // invitee 7 дней + inviter 7 дней
    expect(entitlements.grantPremium).toHaveBeenCalledTimes(2);
    expect(prisma.referralRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inviterUserId: 1, inviteeUserId: 10 }),
      }),
    );
  });

  test('email register: invalid referral => new user gets 3 days trial', async () => {
    const prisma = createPrismaMock();
    const jwt = createJwtMock();
    const sms = createSmsMock();
    const entitlements = createEntitlementsMock();

    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce({ id: 11, email: 'c@d.com', name: 'C', createdAt: new Date() });

    prisma.referralCode.findUnique
      .mockResolvedValueOnce(null) // ensureUserReferralCode(userId=11)
      .mockResolvedValueOnce(null); // referral code lookup fails

    prisma.referralCode.create.mockResolvedValueOnce({ id: 'y', userId: 11, code: 'RUNA5678' });

    const svc = new AuthService(prisma as any, jwt as any, sms as any, createEmailMock() as any, entitlements as any);
    const res = await svc.register({
      name: 'C',
      email: 'c@d.com',
      password: 'password123',
      referralCode: 'NOPE',
      ip: '2.2.2.2',
    });

    expect(res.referralApplied).toBe(false);
    expect(res.referralError).toBe('invalid');
    expect(entitlements.grantPremium).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 11 }, data: expect.objectContaining({ trialUntil: expect.any(Date) }) }),
    );
  });

  test('otp request sends sms and stores hashed otp', async () => {
    const prisma = createPrismaMock();
    const jwt = createJwtMock();
    const sms = createSmsMock();

    prisma.phoneOtp.count.mockResolvedValueOnce(0);
    prisma.phoneOtp.create.mockResolvedValueOnce({ id: 'otp1' });

    const svc = new AuthService(prisma as any, jwt as any, sms as any, createEmailMock() as any, createEntitlementsMock() as any);
    const res = await svc.requestOtp({ phoneE164: '+79001234567', deviceId: 'device-1', ip: '3.3.3.3' });

    expect(res.message).toBe('ok');
    expect(prisma.phoneOtp.create).toHaveBeenCalled();
    expect(sms.sendOtp).toHaveBeenCalled();
  });
});

