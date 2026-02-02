#!/usr/bin/env node
/**
 * Удалить всех пользователей из БД (каскадно удаляются связанные данные).
 * Требуется вход в админ-аккаунт и повторный ввод пароля для подтверждения.
 *
 * Запуск из папки backend-runa:
 *   node scripts/delete-all-users.js
 *
 * Или через npm:
 *   npm run db:delete-all-users
 *
 * В Docker:
 *   docker-compose exec backend node scripts/delete-all-users.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { requireAdminLogin, requirePasswordConfirmAndVerify } = require('./lib/admin-auth');

const prisma = new PrismaClient();

async function main() {
  const admin = await requireAdminLogin(prisma);
  const confirmed = await requirePasswordConfirmAndVerify(
    admin,
    'Повторите пароль админа для подтверждения удаления всех пользователей: '
  );
  if (!confirmed) {
    console.error('Неверный пароль. Операция отменена.');
    process.exit(1);
  }

  const result = await prisma.user.deleteMany({});
  console.log('Удалено пользователей:', result.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
