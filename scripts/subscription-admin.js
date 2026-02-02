#!/usr/bin/env node
/**
 * Выдать или снять Premium подписку пользователю (по email или id).
 * Требуется вход в админ-аккаунт (email + пароль).
 *
 * Запуск с сервера (внутри контейнера или на хосте из папки backend-runa):
 *
 *   node scripts/subscription-admin.js grant <email или userId> [дней]
 *   node scripts/subscription-admin.js revoke <email или userId>
 *
 * Примеры:
 *   node scripts/subscription-admin.js grant user@example.com 365
 *   node scripts/subscription-admin.js grant 5 30
 *   node scripts/subscription-admin.js revoke user@example.com
 *   node scripts/subscription-admin.js revoke 5
 *
 * В Docker:
 *   docker-compose exec backend node scripts/subscription-admin.js grant user@example.com 365
 *   docker-compose exec backend node scripts/subscription-admin.js revoke user@example.com
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { requireAdminLogin } = require('./lib/admin-auth');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const cmd = (args[0] || '').toLowerCase();
const identifier = args[1];
const daysArg = args[2];

async function findUser(identifier) {
  const id = parseInt(identifier, 10);
  if (!Number.isNaN(id) && id > 0) {
    const user = await prisma.user.findUnique({ where: { id }, include: { subscription: true } });
    return user;
  }
  return prisma.user.findUnique({
    where: { email: identifier },
    include: { subscription: true },
  });
}

async function grant(identifier, days) {
  const user = await findUser(identifier);
  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }
  const numDays = Math.max(1, parseInt(days, 10) || 365);
  const premiumUntil = new Date();
  premiumUntil.setDate(premiumUntil.getDate() + numDays);

  if (user.premiumUntil && user.premiumUntil > new Date()) {
    premiumUntil.setTime(user.premiumUntil.getTime() + numDays * 24 * 60 * 60 * 1000);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { premiumUntil },
  });

  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      status: 'ACTIVE',
      store: 'INTERNAL',
      currentPeriodStart: new Date(),
      currentPeriodEnd: premiumUntil,
    },
    update: {
      status: 'ACTIVE',
      currentPeriodEnd: premiumUntil,
    },
  });

  console.log(
    `Premium granted: user id=${user.id} email=${user.email || '(no email)'} until ${premiumUntil.toISOString().slice(0, 10)}`
  );
}

async function revoke(identifier) {
  const user = await findUser(identifier);
  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { premiumUntil: null },
  });

  if (user.subscription) {
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { status: 'NONE', currentPeriodEnd: null },
    });
  }

  console.log(`Premium revoked: user id=${user.id} email=${user.email || '(no email)'}`);
}

async function main() {
  if (cmd !== 'grant' && cmd !== 'revoke') {
    console.error('Usage:');
    console.error('  node scripts/subscription-admin.js grant <email|userId> [days]');
    console.error('  node scripts/subscription-admin.js revoke <email|userId>');
    process.exit(1);
  }
  if (!identifier) {
    console.error('Укажите email или id пользователя.');
    process.exit(1);
  }

  await requireAdminLogin(prisma);

  if (cmd === 'grant') {
    await grant(identifier, daysArg);
  } else {
    await revoke(identifier);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
