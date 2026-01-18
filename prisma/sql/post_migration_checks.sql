-- Apply AFTER Prisma migrations (prisma migrate deploy/dev).
-- This adds DB-level CHECK constraints that Prisma schema can't express.

-- TRANSACTIONS
ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0);

-- GOALS / CONTRIBUTIONS
ALTER TABLE goals
  ADD CONSTRAINT goals_target_amount_positive CHECK (target_amount > 0);

ALTER TABLE goal_contributions
  ADD CONSTRAINT goal_contributions_amount_positive CHECK (amount > 0);

-- INVESTMENTS
ALTER TABLE investment_lots
  ADD CONSTRAINT investment_lots_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT investment_lots_price_positive CHECK (price_per_unit > 0),
  ADD CONSTRAINT investment_lots_fees_non_negative CHECK (fees >= 0);

-- CREDIT / DEPOSIT
ALTER TABLE credit_accounts
  ADD CONSTRAINT credit_accounts_balance_non_negative CHECK (current_balance >= 0),
  ADD CONSTRAINT credit_accounts_interest_rate_range CHECK (interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100)),
  ADD CONSTRAINT credit_accounts_payment_day_range CHECK (payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31)),
  ADD CONSTRAINT credit_accounts_billing_day_range CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
  ADD CONSTRAINT credit_accounts_min_payment_non_negative CHECK (minimum_payment IS NULL OR minimum_payment >= 0),
  ADD CONSTRAINT credit_accounts_credit_limit_non_negative CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD CONSTRAINT credit_accounts_principal_non_negative CHECK (principal IS NULL OR principal >= 0);

ALTER TABLE deposit_accounts
  ADD CONSTRAINT deposit_accounts_principal_positive CHECK (principal > 0),
  ADD CONSTRAINT deposit_accounts_interest_rate_range CHECK (interest_rate >= 0 AND interest_rate <= 100);

-- SCHEDULED EVENTS
ALTER TABLE scheduled_events
  ADD CONSTRAINT scheduled_events_amount_positive CHECK (amount IS NULL OR amount > 0);

