# Security & Anti-Abuse

## Rate Limiting

### Global Rate Limits
- **General API**: 30 requests per minute (via ThrottlerModule)
- **Auth endpoints**: 5 requests per minute (configured per route)
- **AI Chat**: 
  - Free: 10 messages per day
  - Premium: 1000 messages per day

### Implementation
Rate limiting is implemented using `@nestjs/throttler`:
- Redis-backed (via REDIS_URL)
- Configurable per endpoint
- Returns `429 Too Many Requests` when exceeded

## Input Validation

All DTOs use `class-validator`:
- Required fields
- Type validation
- Range checks (e.g., amount > 0)
- String length limits
- Email/phone format validation

## Audit Logging

### Critical Actions Logged

1. **Authentication**
   - Login attempts (success/failure)
   - Token refresh
   - PIN changes
   - OTP requests/verifications

2. **Referral System**
   - Referral code redemptions
   - Device/IP tracking for abuse prevention

3. **Financial Operations**
   - Large transactions (> threshold)
   - Credit debt updates
   - Subscription changes

### Implementation
- Log to database (SubscriptionEvent, ReferralRedemption)
- Include IP, deviceId, userAgent
- Timestamp all actions

## Anti-Abuse Measures

### Referral Abuse Prevention

1. **Self-referral prevention**
   - Cannot use own referral code

2. **Device/IP tracking**
   - Store deviceId and IP for each redemption
   - Detect patterns (same device/IP multiple redemptions)

3. **Single redemption per user**
   - Unique constraint: `inviteeUserId` in ReferralRedemption

4. **Rate limiting**
   - Max 3 OTP requests per 10 minutes per phone

### PIN Security

1. **Lockout mechanism**
   - 5 failed attempts → 10 minute lockout
   - Stored in `PinSecurity.lockedUntil`

2. **Secure hashing**
   - Argon2id for PIN hashing
   - Never store plain PIN

3. **Reset requires re-authentication**
   - Must provide password or OTP

## Secrets Management

### Environment Variables

All secrets in `.env` (never commit):
- `JWT_ACCESS_SECRET` (min 32 chars)
- `JWT_REFRESH_SECRET` (min 32 chars)
- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY` (optional)

### Validation
- Zod schema validation in `env.validation.ts`
- Fails fast on startup if secrets missing/invalid

## Security Checklist

- [x] JWT tokens with expiration
- [x] Refresh token rotation
- [x] Password hashing (Argon2id)
- [x] PIN hashing (Argon2id)
- [x] Rate limiting
- [x] Input validation
- [x] SQL injection protection (Prisma)
- [x] CORS configuration
- [x] Helmet middleware
- [x] Audit logging
- [x] Referral abuse prevention
- [x] Device/IP tracking
- [ ] HTTPS enforcement (production)
- [ ] API key rotation (production)
- [ ] Security headers (CSP, etc.)

## Production Recommendations

1. **Use HTTPS only**
   - Redirect HTTP to HTTPS
   - HSTS headers

2. **Rotate secrets regularly**
   - JWT secrets
   - Database passwords
   - API keys

3. **Monitor suspicious activity**
   - Failed login attempts
   - Unusual transaction patterns
   - Referral abuse patterns

4. **Backup strategy**
   - Regular database backups
   - Encrypted backups

5. **Access control**
   - Principle of least privilege
   - Separate read/write database users if needed
