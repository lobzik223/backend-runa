/**
 * Запрос логина/пароля админа и проверка по таблице admins.
 * Используется в CLI-скриптах (delete-all-users, subscription-admin и т.д.).
 */

const readline = require('readline');
const argon2 = require('argon2');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

function promptEmail() {
  return ask('Admin email: ');
}

function promptPassword(label = 'Admin password') {
  return ask(`${label}: `);
}

/**
 * Проверить email и пароль по таблице admins. Возвращает админа или null.
 */
async function verifyAdmin(prisma, email, password) {
  if (!email || !password) return null;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin) return null;
  const ok = await argon2.verify(admin.passwordHash, password);
  return ok ? admin : null;
}

/**
 * Запросить логин/пароль и проверить. Возвращает admin или process.exit(1).
 */
async function requireAdminLogin(prisma) {
  const count = await prisma.admin.count();
  if (count === 0) {
    console.error('Нет ни одного админ-аккаунта. Сначала создайте админа:');
    console.error('  node scripts/add-admin.js <email> <password>');
    process.exit(1);
  }
  const email = await promptEmail();
  const password = await promptPassword('Admin password');
  const admin = await verifyAdmin(prisma, email, password);
  if (!admin) {
    console.error('Неверный email или пароль.');
    process.exit(1);
  }
  return admin;
}

/**
 * Для деструктивных действий: запросить пароль повторно и проверить, что он совпадает с паролем админа.
 * Возвращает true, если пароль верный.
 */
async function requirePasswordConfirmAndVerify(admin, label = 'Повторите пароль для подтверждения') {
  const password = await promptPassword(label);
  const ok = await argon2.verify(admin.passwordHash, password);
  return ok;
}

module.exports = {
  ask,
  promptEmail,
  promptPassword,
  verifyAdmin,
  requireAdminLogin,
  requirePasswordConfirmAndVerify,
};
