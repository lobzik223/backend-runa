import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PushNotificationsService } from '../modules/push-notifications/push-notifications.service';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const userIdRaw = getArg('userId');
  const title = getArg('title') ?? 'RUNA Finance';
  const body = getArg('body') ?? '';
  const dataRaw = getArg('data'); // JSON string

  const userId = userIdRaw ? Number(userIdRaw) : NaN;
  if (!Number.isFinite(userId) || userId <= 0) {
    // eslint-disable-next-line no-console
    console.error('Usage: npm run push:send -- --userId 123 --title "..." --body "..." [--data "{\\"k\\":\\"v\\"}"]');
    process.exit(1);
  }
  if (!body) {
    // eslint-disable-next-line no-console
    console.error('Error: --body is required');
    process.exit(1);
  }

  let data: Record<string, any> | undefined;
  if (dataRaw) {
    try {
      data = JSON.parse(dataRaw);
    } catch {
      // eslint-disable-next-line no-console
      console.error('Error: --data must be valid JSON');
      process.exit(1);
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const push = app.get(PushNotificationsService);
    const tokens = await push.getUserPushTokens(userId);
    if (tokens.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`[push:send] No tokens for user ${userId}`);
      return;
    }

    const results = await Promise.allSettled(
      tokens.map(({ token, platform }) =>
        push.sendPushNotification(token, platform, push.createUnifiedPayload(title, body, platform, data)),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    // eslint-disable-next-line no-console
    console.log(`[push:send] Sent to ${ok}/${tokens.length} devices`);
  } finally {
    await app.close();
  }
}

void main();

