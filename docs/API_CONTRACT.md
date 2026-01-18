# RUNA Finance API Contract

## Base URL
```
https://api.runa.finance/api
```

## Authentication

All protected endpoints require JWT Bearer token in Authorization header:
```
Authorization: Bearer <access_token>
```

## Endpoints

### Authentication

#### POST /auth/register
Register new user with email/password.

**Request:**
```json
{
  "name": "Иван Иванов",
  "email": "user@example.com",
  "password": "securePassword123",
  "referralCode": "RUNA12345678" // optional
}
```

**Response:**
```json
{
  "message": "ok",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "Иван Иванов",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### POST /auth/login
Login with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:** Same as register.

#### POST /auth/otp/request
Request OTP for phone authentication.

**Request:**
```json
{
  "phoneE164": "+79991234567"
}
```

#### POST /auth/otp/verify
Verify OTP and login/register.

**Request:**
```json
{
  "phoneE164": "+79991234567",
  "code": "123456",
  "name": "Иван Иванов", // optional, for new users
  "referralCode": "RUNA12345678" // optional
}
```

#### POST /auth/refresh
Refresh access token.

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### GET /auth/me
Get current user info.

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "Иван Иванов",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

### PIN Security

#### GET /pin/status
Check PIN status.

**Response:**
```json
{
  "hasPin": true,
  "biometricEnabled": false
}
```

#### POST /pin/set
Set or update PIN.

**Request:**
```json
{
  "pin": "1234",
  "confirmPin": "1234",
  "biometricEnabled": false
}
```

#### POST /pin/verify
Verify PIN.

**Request:**
```json
{
  "pin": "1234"
}
```

#### POST /pin/reset
Reset PIN (requires re-authentication).

**Request:**
```json
{
  "password": "securePassword123" // or OTP for phone users
}
```

### Transactions

#### POST /transactions
Create transaction.

**Request:**
```json
{
  "type": "EXPENSE",
  "amount": 1500.50,
  "currency": "RUB",
  "occurredAt": "2024-01-15T10:00:00Z",
  "categoryId": 1,
  "paymentMethodId": 2,
  "note": "Обед в ресторане"
}
```

**Response:**
```json
{
  "id": "123",
  "type": "EXPENSE",
  "amount": "1500.50",
  "currency": "RUB",
  "occurredAt": "2024-01-15T10:00:00Z",
  "category": { "id": 1, "name": "Еда" },
  "paymentMethod": { "id": 2, "name": "Карта" },
  "note": "Обед в ресторане"
}
```

#### GET /transactions
List transactions with filters.

**Query params:**
- `startDate` (ISO string)
- `endDate` (ISO string)
- `type` (INCOME | EXPENSE)
- `categoryId` (number)
- `paymentMethodId` (number)
- `page` (number, default: 1)
- `limit` (number, default: 20)

**Response:**
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### GET /transactions/analytics
Get analytics for date range.

**Query params:**
- `startDate` (ISO string)
- `endDate` (ISO string)
- `timezone` (string, default: "Europe/Moscow")

**Response:**
```json
{
  "incomeTotal": 50000,
  "expenseTotal": 35000,
  "net": 15000,
  "incomeByCategory": [
    { "category": "Зарплата", "amount": 50000, "percent": 100 }
  ],
  "expenseByCategory": [
    { "category": "Еда", "amount": 15000, "percent": 42.86 },
    { "category": "Транспорт", "amount": 5000, "percent": 14.29 }
  ]
}
```

### Investments

#### POST /investments/assets
Add investment asset.

**Request:**
```json
{
  "tickerOrName": "AAPL",
  "assetType": "STOCK", // optional
  "exchange": "NASDAQ" // optional
}
```

#### POST /investments/lots
Add investment lot.

**Request:**
```json
{
  "assetId": 1,
  "quantity": 10,
  "pricePerUnit": 150.50,
  "fees": 5.00,
  "boughtAt": "2024-01-15T10:00:00Z"
}
```

#### GET /investments/portfolio
Get portfolio with metrics.

**Response:**
```json
{
  "assets": [
    {
      "assetId": 1,
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "totalQuantity": 15,
      "averageBuyPrice": 150.33,
      "totalCost": 2255.00,
      "currentValue": 2632.50,
      "pnlValue": 377.50,
      "pnlPercent": 16.74
    }
  ],
  "totalCost": 2255.00,
  "totalCurrentValue": 2632.50,
  "totalPnlValue": 377.50,
  "totalPnlPercent": 16.74
}
```

### AI Chat

#### POST /ai/chat
Send message to AI.

**Request:**
```json
{
  "message": "Покажи график моих расходов",
  "threadId": "optional-thread-id"
}
```

**Response:**
```json
{
  "message": "Вот ваш график расходов...",
  "structuredOutputs": [
    {
      "type": "chart_request",
      "payload": {
        "title": "График доходов и расходов",
        "chartType": "donut",
        "data": {
          "chartType": "donut",
          "incomeTotal": 50000,
          "expenseTotal": 35000,
          "incomeByCategory": [...],
          "expenseByCategory": [...]
        }
      }
    }
  ],
  "chartData": {
    "chartType": "donut",
    "incomeTotal": 50000,
    "expenseTotal": 35000,
    "incomeByCategory": [...],
    "expenseByCategory": [...],
    "dateRange": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-01-31T23:59:59Z"
    }
  },
  "threadId": "uuid",
  "messageId": "uuid"
}
```

#### GET /ai/threads
List user threads.

#### GET /ai/threads/:id
Get thread history.

### Market News

#### GET /market-news
Get latest market news.

**Query params:**
- `limit` (number, default: 20)

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Новость о рынке",
    "content": "Текст новости...",
    "source": "RBC",
    "sourceUrl": "https://...",
    "publishedAt": "2024-01-15T10:00:00Z"
  }
]
```

### Push Notifications

#### POST /push-notifications/token
Update push token.

**Request:**
```json
{
  "deviceId": "stable-device-id",
  "pushToken": "fcm-token-or-apns-token",
  "platform": "ios" // or "android"
}
```

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

**Common status codes:**
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error

## Rate Limits

- **Auth endpoints**: 5 requests per minute
- **AI Chat**: 
  - Free: 10 messages per day
  - Premium: 1000 messages per day
- **General API**: 30 requests per minute

## Subscription & Entitlements

- **Free tier**: 3-day trial by default
- **With referral**: 7-day premium trial for both users
- **Premium**: Unlimited AI messages, advanced analytics

Check premium status via subscription status or `premiumUntil` date.
