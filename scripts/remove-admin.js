#!/usr/bin/env node
/**
 * Удалить админ-аккаунт по email.
 * Требуется вход другого админа. Последнего админа удалить нельзя.
 *
 * Использование:
 *   node scripts/remove-admin.js <email админа для удаления>
 *
 * Пример:
 *   node scripts/remove-admin.js oldadmin@example.com
 *
 * Или без аргумента — скрипт запросит email удаляемого админа.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { requireAdminLogin, ask } = require('./lib/admin-auth');

const prisma = new PrismaClient();

async function main() {
  await requireAdminLogin(prisma);

  const emailArg = process.argv[2];
  const emailToRemove = (emailArg && emailArg.trim()) || (await ask('Email админа для удаления: ')).trim().toLowerCase();
  if (!emailToRemove) {
    console.error('Укажите email админа.');
    process.exit(1);
  }

  const count = await prisma.admin.count();
  if (count <= 1) {
    console.error('Нельзя удалить последнего админа. Должен остаться хотя бы один.');
    process.exit(1);
  }

  const admin = await prisma.admin.findUnique({ where: { email: emailToRemove } });
  if (!admin) {
    console.error('Админ с таким email не найден:', emailToRemove);
    process.exit(1);
  }

  await prisma.admin.delete({ where: { id: admin.id } });
  console.log('Админ удалён:', admin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
