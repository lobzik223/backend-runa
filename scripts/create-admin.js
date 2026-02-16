#!/usr/bin/env node
/**
 * Создание аккаунта админа для панели. Только через командную строку на сервере.
 * Админы не связаны с пользователями приложения.
 *
 * Использование:
 *   node scripts/create-admin.js <email> <пароль> [имя]
 *
 * Пример:
 *   node scripts/create-admin.js admin@runafinance.online "SecurePassword123" "Super Admin"
 *
 * В Docker (на сервере так и запускайте — иначе нет node_modules):
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/create-admin.js admin@example.com "YourPassword" "Имя"
 */

try {
  require('dotenv').config();
} catch (_) {
  // В Docker переменные заданы через compose; на хосте без node_modules запускайте через: docker compose exec backend node scripts/...
}
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const email = args[0]?.trim()?.toLowerCase();
const password = args[1];
const name = args[2]?.trim() || null;

const MIN_PASSWORD_LENGTH = 8;

async function main() {
  if (!email || !password) {
    console.error('Использование: node scripts/create-admin.js <email> <пароль> [имя]');
    console.error('Пример: node scripts/create-admin.js admin@runafinance.online "SecurePass123" "Super Admin"');
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов.`);
    process.exit(1);
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.error(`Админ с email ${email} уже существует.`);
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
  });

  await prisma.admin.create({
    data: {
      email,
      passwordHash,
      name: name || 'Super Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log('OK: Админ создан.');
  console.log('  Email:', email);
  console.log('  Имя:', name || 'Super Admin');
  console.log('  Роль: SUPER_ADMIN');
  console.log('Вход в панель: POST /api/admin/auth/login с телом { "email", "password" }');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
