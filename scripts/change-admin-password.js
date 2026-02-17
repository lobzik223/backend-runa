#!/usr/bin/env node
/**
 * Смена пароля админа по email. Только через командную строку на сервере.
 *
 * Использование:
 *   node scripts/change-admin-password.js <email> <новый_пароль>
 *
 * В Docker:
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/change-admin-password.js admin@example.com "NewPassword123"
 */

try {
  require('dotenv').config();
} catch (_) {}
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

const email = process.argv[2]?.trim()?.toLowerCase();
const newPassword = process.argv[3];
const MIN_PASSWORD_LENGTH = 8;

async function main() {
  if (!email || !newPassword) {
    console.error('Использование: node scripts/change-admin-password.js <email> <новый_пароль>');
    console.error('Пример: node scripts/change-admin-password.js admin@runafinance.online "NewSecurePass123"');
    process.exit(1);
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов.`);
    process.exit(1);
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    console.error('Админ с таким email не найден:', email);
    process.exit(1);
  }

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
  });

  await prisma.admin.update({
    where: { email },
    data: { passwordHash },
  });

  console.log('OK: Пароль админа обновлён:', email);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
