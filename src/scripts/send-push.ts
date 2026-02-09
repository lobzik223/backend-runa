import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/prisma/prisma.service';
import { PushNotificationsService } from '../modules/push-notifications/push-notifications.service';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const userIdRaw = getArg('userId');
  const sendToAll = hasFlag('all');
  const title = getArg('title') ?? 'RUNA Finance';
  const body = getArg('body') ?? '';
  const dataRaw = getArg('data'); // JSON string

  if (!sendToAll && (!userIdRaw || !Number.isFinite(Number(userIdRaw)) || Number(userIdRaw) <= 0)) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: npm run push:send -- --userId 123 --body "..." [--title "..."] [--data "{}"]\n       npm run push:send -- --all --body "..." [--title "..."]',
    );
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
    const prisma = app.get(PrismaService);

    const userIds: number[] = sendToAll
      ? (
          await prisma.device.findMany({
            where: { pushToken: { not: null }, userId: { not: null } },
            select: { userId: true },
            distinct: ['userId'],
          })
        ).map((d) => d.userId!)
      : [Number(userIdRaw)];

    if (userIds.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[push:send] No users with push tokens found');
      return;
    }

    let totalSent = 0;
    let totalDevices = 0;
    for (const userId of userIds) {
      const tokens = await push.getUserPushTokens(userId);
      if (tokens.length === 0) continue;
      totalDevices += tokens.length;
      const results = await Promise.allSettled(
        tokens.map(({ token, platform }) =>
          push.sendPushNotification(token, platform, push.createUnifiedPayload(title, body, platform, data)),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      totalSent += ok;
    }
    // eslint-disable-next-line no-console
    console.log(`[push:send] Sent to ${totalSent}/${totalDevices} devices (${userIds.length} users)`);
  } finally {
    await app.close();
  }
}

void main();

