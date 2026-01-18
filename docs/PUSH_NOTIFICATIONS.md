# Push Notifications Implementation

## Overview

Push notifications are sent 1 day before each scheduled event (loan payments, deposit interest, etc.) to remind users of upcoming financial actions.

## Architecture

### Components

1. **PushNotificationsService**: Handles token management and notification sending
2. **ScheduledEventsNotificationJob**: Cron job that runs every hour to check for events occurring tomorrow
3. **Worker**: BullMQ worker for processing push notification jobs (optional, for async processing)

### Database Schema

#### Device Model
- `pushToken`: FCM token (Android) or APNs token (iOS)
- `pushTokenUpdatedAt`: Timestamp of last token update
- `platform`: 'ios' | 'android' | 'web'

#### ScheduledEvent Model
- `lastNotifiedAt`: Timestamp of last notification sent (for deduplication)

## Notification Flow

1. **Cron Job** (`ScheduledEventsNotificationJob`):
   - Runs every hour (`@Cron(CronExpression.EVERY_HOUR)`)
   - Finds events with `dueAt` between tomorrow 00:00 and 23:59
   - Filters events that haven't been notified yet (`lastNotifiedAt IS NULL`) or were notified more than 23 hours ago
   - Calls `sendScheduledEventNotification()` for each event

2. **Notification Sending**:
   - Gets all active push tokens for the user
   - Formats message based on event kind
   - Creates platform-specific payload (iOS/Android)
   - Sends notification to all user devices
   - Updates `lastNotifiedAt` if at least one notification was sent successfully

## Message Templates (Russian)

### Credit Payment
```
Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту [amount]. Не пропусти. Дисциплина = свобода.
```

### Deposit Interest
```
Завтра день X. У тебя по плану финансовое действие: — 💰 Проценты по вкладу [amount]. Не пропусти. Дисциплина = свобода.
```

### Goal Contribution
```
Завтра день X. У тебя по плану финансовое действие: — 🎯 Вклад в цель [amount]. Не пропусти. Дисциплина = свобода.
```

## Push Notification Payload Formats

### iOS (APNs)

```json
{
  "title": "RUNA Finance",
  "body": "Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту 5 000 ₽. Не пропусти. Дисциплина = свобода.",
  "data": {
    "eventId": "123",
    "eventKind": "CREDIT_PAYMENT",
    "amount": "5000",
    "currency": "RUB"
  },
  "apns": {
    "payload": {
      "aps": {
        "alert": {
          "title": "RUNA Finance",
          "body": "Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту 5 000 ₽. Не пропусти. Дисциплина = свобода."
        },
        "sound": "default",
        "badge": 1
      }
    }
  }
}
```

### Android (FCM)

```json
{
  "title": "RUNA Finance",
  "body": "Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту 5 000 ₽. Не пропусти. Дисциплина = свобода.",
  "data": {
    "eventId": "123",
    "eventKind": "CREDIT_PAYMENT",
    "amount": "5000",
    "currency": "RUB"
  },
  "android": {
    "notification": {
      "title": "RUNA Finance",
      "body": "Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту 5 000 ₽. Не пропусти. Дисциплина = свобода.",
      "sound": "default",
      "channelId": "runa_finance_default"
    },
    "data": {
      "eventId": "123",
      "eventKind": "CREDIT_PAYMENT",
      "amount": "5000",
      "currency": "RUB"
    }
  }
}
```

## Device Token Management

### API Endpoint

**POST** `/api/push-notifications/token`

**Request Body:**
```json
{
  "deviceId": "stable-device-identifier",
  "pushToken": "fcm-token-or-apns-token",
  "platform": "ios" | "android" | "web"
}
```

**Response:**
```json
{
  "id": "uuid",
  "deviceId": "stable-device-identifier",
  "userId": 1,
  "platform": "ios",
  "pushToken": "fcm-token-or-apns-token",
  "pushTokenUpdatedAt": "2024-01-15T10:00:00Z",
  "lastSeenAt": "2024-01-15T10:00:00Z"
}
```

### Token Update Flow

1. Mobile app calls `/api/push-notifications/token` after user logs in
2. If device doesn't exist, creates new Device record
3. If device exists, updates `pushToken` and `pushTokenUpdatedAt`
4. Token is stored in `Device.pushToken` field

### Token Removal

To remove a push token (e.g., user logs out), send:
```json
{
  "deviceId": "stable-device-identifier",
  "pushToken": null
}
```

## Deduplication

Notifications are deduplicated using `lastNotifiedAt`:

- Event is notified if `lastNotifiedAt IS NULL` (never notified)
- OR if `lastNotifiedAt < NOW() - 23 hours` (allows re-notification if needed)
- After successful notification, `lastNotifiedAt` is updated to current timestamp

This ensures:
- Each event gets notified exactly once per day
- If job runs multiple times, duplicate notifications are prevented
- If notification fails, it can be retried on next run

## Production Integration

### FCM (Firebase Cloud Messaging) for Android

1. Set up Firebase project
2. Get FCM server key or service account
3. Use FCM REST API: `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`
4. Or use Firebase Admin SDK

### APNs (Apple Push Notification service) for iOS

1. Set up Apple Developer account
2. Create APNs key or certificate
3. Use APNs HTTP/2 API: `https://api.push.apple.com/3/device/{token}`
4. Or use `node-apn` library

### Implementation Notes

Current implementation logs notifications. To enable actual sending:

1. Update `PushNotificationsService.sendPushNotification()` method
2. Add FCM/APNs credentials to environment variables
3. Integrate with FCM/APNs SDKs or REST APIs
4. Handle errors and retries
5. Log to audit table for tracking

## Cron Schedule

- **Current**: Every hour (`CronExpression.EVERY_HOUR`)
- **Alternative**: Daily at 9 AM (`CronExpression.EVERY_DAY_AT_9AM`)

To change schedule, update `@Cron()` decorator in `ScheduledEventsNotificationJob`.

## Testing

Run tests:
```bash
npm test -- push-notifications.service.spec.ts
```

Test coverage:
- Token management (create/update)
- Message formatting
- Payload creation (iOS/Android)
- Deduplication logic
