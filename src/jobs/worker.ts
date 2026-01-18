import 'reflect-metadata';
import { Worker } from 'bullmq';
import { env } from '../config/env.validation';

/**
 * BullMQ worker entry point for background jobs.
 *
 * Note: In production run as a separate process/container.
 * This worker handles push notification jobs queued from the main application.
 */

console.log('[worker] starting with REDIS_URL=', env.REDIS_URL);

/**
 * Push notification worker
 * Processes push notification jobs from the "push" queue.
 *
 * Job data format:
 * {
 *   token: string,
 *   platform: 'ios' | 'android' | null,
 *   payload: PushNotificationPayload
 * }
 */
const pushWorker = new Worker(
  'push',
  async (job) => {
    const { token, platform, payload } = job.data;

    console.log(`[worker][push] Processing job ${job.id}: ${platform || 'unknown'} token ${token?.substring(0, 20)}...`);

    // TODO: Integrate with actual FCM/APNs services
    // For now, just log the notification
    console.log('[worker][push] Payload:', JSON.stringify(payload, null, 2));

    // In production, this would:
    // 1. Call FCM API for Android: https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
    // 2. Call APNs API for iOS: https://api.push.apple.com/3/device/{token}
    // 3. Handle retries and errors
    // 4. Log to audit table

    return { success: true, sentAt: new Date().toISOString() };
  },
  {
    connection: { url: env.REDIS_URL },
    // Worker options: retries and error handling are configured per job
  },
);

pushWorker.on('completed', (job) => {
  console.log(`[worker][push] Job ${job.id} completed`);
});

pushWorker.on('failed', (job, err) => {
  console.error(`[worker][push] Job ${job?.id} failed:`, err.message);
});

console.log('[worker] Push notification worker started');
