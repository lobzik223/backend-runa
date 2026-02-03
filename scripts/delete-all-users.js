#!/usr/bin/env node
/**
 * Удалить всех пользователей из БД (каскадно удаляются связанные данные).
 *
 * Запуск из папки backend-runa:
 *   node scripts/delete-all-users.js
 *
 * Или через npm:
 *   npm run db:delete-all-users
 *
 * В Docker:
 *   docker exec -it runa_backend node scripts/delete-all-users.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.deleteMany({});
  console.log('Удалено пользователей:', result.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
