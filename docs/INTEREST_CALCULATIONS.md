# Interest Calculation Formulas and Assumptions

## Overview

This document describes the interest calculation formulas and assumptions used in the RUNA Finance backend for loan payments and deposit interest.

## Formulas

### Loan Interest (Monthly)

**Formula:**
```
Monthly Interest = Current Balance × (APR / 100) / 12
```

**Example:**
- Current Balance: 100,000 RUB
- APR: 12% (annual)
- Monthly Interest = 100,000 × (12 / 100) / 12 = 1,000 RUB

### Loan Payment (Total)

**Formula:**
```
Total Payment = Monthly Interest + Minimum Payment
```

If no minimum payment is specified, the payment is interest-only:
```
Total Payment = Monthly Interest
```

**Example:**
- Current Balance: 100,000 RUB
- APR: 12%
- Minimum Payment: 5,000 RUB
- Monthly Interest = 1,000 RUB
- Total Payment = 1,000 + 5,000 = 6,000 RUB

### Deposit Interest (Monthly)

**Formula:**
```
Monthly Interest = Principal × (APR / 100) / 12
```

**Example:**
- Principal: 100,000 RUB
- APR: 5% (annual)
- Monthly Interest = 100,000 × (5 / 100) / 12 = 416.67 RUB

## Assumptions

1. **Simple Interest**: We use simple interest calculation (not compound interest).
2. **Monthly Compounding**: Interest is calculated monthly, dividing the annual rate by 12.
3. **APR Format**: APR is provided as a percentage (e.g., 12.5 for 12.5%).
4. **Loan Payments**: 
   - Payments are calculated based on current balance at the time of calculation.
   - If minimum payment is provided, total payment = interest + minimum payment.
   - If no minimum payment, payment is interest-only.
5. **Deposit Interest**:
   - Interest is calculated on the principal amount.
   - Payout schedule can be MONTHLY, QUARTERLY, or AT_MATURITY.
6. **Date Calculations**:
   - Next payment/payout dates are calculated by adding the appropriate period (1 month, 3 months, etc.) to the base date.
   - Year rollover is handled correctly (e.g., December + 1 month = January of next year).

## Scheduled Events

### Loan Payment Events

- **Kind**: `CREDIT_PAYMENT`
- **Created when**: Loan account is created/updated with APR and next payment date
- **Updated when**: Loan balance, APR, next payment date, or minimum payment changes
- **Amount**: Calculated using `calculateLoanPayment()` formula

### Deposit Interest Events

- **Kind**: `DEPOSIT_INTEREST`
- **Created when**: Deposit account is created/updated with APR and next payout date
- **Updated when**: Principal, APR, payout schedule, or next payout date changes
- **Amount**: Calculated using `calculateDepositInterest()` formula

## Edge Cases

1. **Zero Balance/Principal**: Returns 0 interest
2. **Negative APR**: Returns 0 interest (invalid input)
3. **No APR**: No scheduled events created
4. **No Payment Date**: Uses current date as default
5. **AT_MATURITY Schedule**: Uses maturity date as payout date

## Implementation

All calculations are implemented in `InterestCalculatorService`:
- `calculateLoanInterest(currentBalance, apr)`
- `calculateLoanPayment(currentBalance, apr, minimumPayment?)`
- `calculateDepositInterest(principal, apr)`
- `calculateNextPaymentDate(baseDate)`
- `calculateNextPayoutDate(baseDate, schedule)`

Scheduled events are automatically created/updated when accounts are created or modified through the respective service methods.
