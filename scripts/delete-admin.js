#!/usr/bin/env node
/**
 * Удаление аккаунта админа по email. Только через командную строку на сервере.
 *
 * Использование:
 *   node scripts/delete-admin.js <email>
 *
 * В Docker:
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/delete-admin.js admin@example.com
 */

try {
  require('dotenv').config();
} catch (_) {}
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const email = process.argv[2]?.trim()?.toLowerCase();

async function main() {
  if (!email) {
    console.error('Использование: node scripts/delete-admin.js <email>');
    process.exit(1);
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    console.error('Админ с таким email не найден:', email);
    process.exit(1);
  }

  await prisma.admin.delete({ where: { email } });
  console.log('OK: Админ удалён:', email);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
