#!/usr/bin/env node
/**
 * Управление Premium и просмотр статуса пользователя (по email или id).
 *
 * Команды:
 *   grant <email|id> <дней 1-360>   — выдать дни (добавляются к текущему сроку, если премиум уже есть)
 *   revoke <email|id>               — снять подписку полностью
 *   reduce <email|id> <дней 1-360>  — убрать N дней с конца срока
 *   status <email|id>               — показать статус пользователя (ник, почта, подписка, дни осталось)
 *
 * Примеры:
 *   node scripts/subscription-admin.js grant user@example.com 30
 *   node scripts/subscription-admin.js reduce user@example.com 7
 *   node scripts/subscription-admin.js status 5
 *   node scripts/subscription-admin.js status user@example.com
 *
 * В Docker:
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js status user@example.com
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js grant user@example.com 90
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const cmd = (args[0] || '').toLowerCase();
const identifier = args[1];
const daysArg = args[2];

const MIN_DAYS = 1;
const MAX_DAYS = 360;

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

function clampDays(daysStr, defaultVal = 30) {
  const n = parseInt(daysStr, 10);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

async function grant(identifier, days) {
  const user = await findUser(identifier);
  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }
  const numDays = clampDays(days, 30);

  const now = new Date();
  let premiumUntil = new Date(now);
  premiumUntil.setDate(premiumUntil.getDate() + numDays);

  if (user.premiumUntil && user.premiumUntil > now) {
    premiumUntil = new Date(user.premiumUntil.getTime() + numDays * 24 * 60 * 60 * 1000);
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
    `Premium: +${numDays} дн. → id=${user.id} email=${user.email || '(no email)'} до ${premiumUntil.toISOString().slice(0, 10)}`
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

  console.log(`Premium снят: id=${user.id} email=${user.email || '(no email)'}`);
}

async function reduce(identifier, days) {
  const user = await findUser(identifier);
  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }
  const numDays = clampDays(days, 1);

  const now = new Date();
  if (!user.premiumUntil || user.premiumUntil <= now) {
    console.log('У пользователя нет активного премиума. Нечего уменьшать.');
    return;
  }

  const ms = numDays * 24 * 60 * 60 * 1000;
  let premiumUntil = new Date(user.premiumUntil.getTime() - ms);
  if (premiumUntil <= now) {
    premiumUntil = null;
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
    console.log(`Premium: −${numDays} дн. → подписка снята (срок истёк). id=${user.id} email=${user.email || '(no email)'}`);
  } else {
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
        currentPeriodEnd: premiumUntil,
      },
    });
    console.log(
      `Premium: −${numDays} дн. → id=${user.id} email=${user.email || '(no email)'} до ${premiumUntil.toISOString().slice(0, 10)}`
    );
  }
}

async function status(identifier) {
  const user = await findUser(identifier);
  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }

  const now = new Date();
  let subStatus = 'NONE';
  let daysLeft = 0;
  let periodEnd = null;

  if (user.premiumUntil && user.premiumUntil > now) {
    subStatus = 'ACTIVE';
    periodEnd = user.premiumUntil;
    daysLeft = Math.ceil((user.premiumUntil - now) / (24 * 60 * 60 * 1000));
  } else if (user.subscription && user.subscription.status === 'ACTIVE' && user.subscription.currentPeriodEnd && user.subscription.currentPeriodEnd > now) {
    subStatus = user.subscription.status;
    periodEnd = user.subscription.currentPeriodEnd;
    daysLeft = Math.ceil((user.subscription.currentPeriodEnd - now) / (24 * 60 * 60 * 1000));
  }

  const trialUntil = user.trialUntil && user.trialUntil > now
    ? `${user.trialUntil.toISOString().slice(0, 10)} (осталось ${Math.ceil((user.trialUntil - now) / (24 * 60 * 60 * 1000))} дн.)`
    : user.trialUntil
      ? user.trialUntil.toISOString().slice(0, 10) + ' (истёк)'
      : '—';

  console.log('---');
  console.log('id:', user.id);
  console.log('email:', user.email || '—');
  console.log('ник (name):', user.name || '—');
  console.log('подписка:', subStatus);
  console.log('премиум до:', periodEnd ? periodEnd.toISOString().slice(0, 10) : '—');
  console.log('дней премиума осталось:', daysLeft);
  console.log('триал до:', trialUntil);
  console.log('store:', user.subscription?.store || '—');
  console.log('---');
}

async function main() {
  if (!cmd || !['grant', 'revoke', 'reduce', 'status'].includes(cmd)) {
    console.error('Usage:');
    console.error('  node scripts/subscription-admin.js grant <email|id> <дней 1-360>');
    console.error('  node scripts/subscription-admin.js revoke <email|id>');
    console.error('  node scripts/subscription-admin.js reduce <email|id> <дней 1-360>');
    console.error('  node scripts/subscription-admin.js status <email|id>');
    process.exit(1);
  }
  if (!identifier) {
    console.error('Укажите email или id пользователя.');
    process.exit(1);
  }

  if (cmd === 'status') {
    await status(identifier);
    await prisma.$disconnect();
    return;
  }

  if (cmd === 'grant') {
    await grant(identifier, daysArg);
  } else if (cmd === 'revoke') {
    await revoke(identifier);
  } else if (cmd === 'reduce') {
    await reduce(identifier, daysArg);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
