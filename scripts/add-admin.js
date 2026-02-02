#!/usr/bin/env node
/**
 * Добавить админ-аккаунт в БД (таблица admins, не связана с пользователями).
 *
 * Первый админ (когда в БД ещё нет админов):
 *   node scripts/add-admin.js <email> <password>
 *
 * Пример:
 *   node scripts/add-admin.js admin@runafinance.online MySecurePassword123
 *
 * Следующие админы (уже есть хотя бы один) — скрипт запросит логин/пароль текущего админа:
 *   node scripts/add-admin.js <email> <password>
 *
 * Или через npm:
 *   npm run db:add-admin -- admin@example.com password
 *
 * Перед первым запуском выполните миграцию:
 *   npx prisma migrate dev --name add_admins
 */

require('dotenv').config();
const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');
const { promptEmail, promptPassword, verifyAdmin, ask } = require('./lib/admin-auth');

const prisma = new PrismaClient();

async function addAdmin(email, password) {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm || !password) {
    console.error('Укажите email и пароль.');
    process.exit(1);
  }
  const existing = await prisma.admin.findUnique({ where: { email: emailNorm } });
  if (existing) {
    console.error('Админ с таким email уже существует.');
    process.exit(1);
  }
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
  });
  await prisma.admin.create({
    data: { email: emailNorm, passwordHash },
  });
  console.log('Админ добавлен:', emailNorm);
}

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const password = args[1];

  const count = await prisma.admin.count();

  if (count === 0) {
    if (!email || !password) {
      console.error('Первый админ. Использование: node scripts/add-admin.js <email> <password>');
      process.exit(1);
    }
    await addAdmin(email, password);
    await prisma.$disconnect();
    return;
  }

  // Уже есть админы — требуем вход текущего админа
  const adminEmail = await promptEmail();
  const adminPassword = await promptPassword('Admin password');
  const admin = await verifyAdmin(prisma, adminEmail, adminPassword);
  if (!admin) {
    console.error('Неверный email или пароль.');
    process.exit(1);
  }

  const newEmail = (email && email.trim()) || (await ask('New admin email: ')).trim();
  const newPassword = (password && password.trim()) || (await ask('New admin password: ')).trim();
  await addAdmin(newEmail, newPassword);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
