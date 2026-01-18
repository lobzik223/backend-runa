// This will be added to Prisma schema
// For now, using a TypeScript interface

export interface AIInsight {
  id: string;
  userId: number;
  type: 'expense_spike' | 'budget_deficit' | 'inactivity' | 'goal_achieved' | 'plan_violation';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  metadata?: Record<string, any>;
  acknowledgedAt?: Date | null;
  createdAt: Date;
}
