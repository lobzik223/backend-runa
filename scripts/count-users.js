/**
 * Считает строки в таблице users (все аккаунты, включая с запросом на удаление).
 * Запуск из корня backend-runa: npm run db:count-users
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.user.count();
  const pendingDeletion = await prisma.user.count({
    where: { deletionRequestedAt: { not: null } },
  });
  console.log('Всего записей в users:', total);
  console.log('Из них с запросом на удаление (deletionRequestedAt):', pendingDeletion);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
