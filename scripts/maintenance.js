#!/usr/bin/env node
/**
 * Включить/выключить режим «Ведутся работы» на сервере.
 * В приложении у пользователей показывается экран «Ведутся работы на сервере».
 *
 * Использование (внутри контейнера или локально):
 *   node scripts/maintenance.js on   — включить режим обслуживания
 *   node scripts/maintenance.js off  — выключить (пользователи снова увидят приложение)
 *
 * В Docker:
 *   docker-compose exec backend node scripts/maintenance.js on
 *   docker-compose exec backend node scripts/maintenance.js off
 *
 * Или через API (с хоста, если известен APP_KEY):
 *   curl -X POST http://localhost:3000/api/health/maintenance -H "Content-Type: application/json" -d '{"enabled":true}' -H "X-Runa-App-Key: YOUR_APP_KEY"
 *   curl -X POST http://localhost:3000/api/health/maintenance -H "Content-Type: application/json" -d '{"enabled":false}' -H "X-Runa-App-Key: YOUR_APP_KEY"
 */

const fs = require('fs');
const path = require('path');

const flagPath = process.env.MAINTENANCE_FLAG_PATH || path.join(process.cwd(), 'data', 'maintenance.flag');
const cmd = (process.argv[2] || '').toLowerCase();

if (cmd === 'on') {
  const dir = path.dirname(flagPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(flagPath, '1', 'utf8');
  console.log('Maintenance mode ON. Users will see "Ведутся работы на сервере".');
  process.exit(0);
} else if (cmd === 'off') {
  if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
  console.log('Maintenance mode OFF. Users will see the app again.');
  process.exit(0);
} else {
  console.error('Usage: node scripts/maintenance.js on | off');
  process.exit(1);
}
