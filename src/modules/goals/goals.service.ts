import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { AddGoalContributionDto } from './dto/add-goal-contribution.dto';

const FREE_GOALS_LIMIT = 2;
const PREMIUM_GOALS_LIMIT = 100;

@Injectable()
export class GoalsService {
  constructor(
    private prisma: PrismaService,
    private entitlements: EntitlementsService,
  ) {}

  private serializeGoal(goal: any) {
    const targetAmount = Number(goal.targetAmount);
    const currentAmount = goal.contributions?.reduce((s: number, c: any) => s + Number(c.amount), 0) ?? 0;
    const progressPercent = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;

    return {
      id: goal.id,
      name: goal.name,
      targetAmount,
      currency: goal.currency,
      targetDate: goal.targetDate ? new Date(goal.targetDate).toISOString() : null,
      status: goal.status,
      createdAt: goal.createdAt ? new Date(goal.createdAt).toISOString() : null,
      updatedAt: goal.updatedAt ? new Date(goal.updatedAt).toISOString() : null,
      currentAmount,
      remainingAmount: Math.max(0, targetAmount - currentAmount),
      progressPercent: Math.max(0, Math.min(100, progressPercent)),
      contributions:
        goal.contributions?.map((c: any) => ({
          id: typeof c.id === 'bigint' ? c.id.toString() : c.id,
          amount: Number(c.amount),
          currency: c.currency,
          occurredAt: c.occurredAt ? new Date(c.occurredAt).toISOString() : null,
          note: c.note ?? null,
          createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
        })) ?? [],
    };
  }

  async create(userId: number, dto: CreateGoalDto) {
    const isPremium = await this.entitlements.isPremium(userId);
    const limit = isPremium ? PREMIUM_GOALS_LIMIT : FREE_GOALS_LIMIT;
    const activeCount = await this.prisma.goal.count({
      where: { userId, status: 'ACTIVE' },
    });
    if (activeCount >= limit) {
      throw new ForbiddenException(
        isPremium
          ? 'GOALS_LIMIT_REACHED'
          : 'GOALS_FREE_LIMIT_REACHED',
      );
    }

    const goal = await this.prisma.goal.create({
      data: {
        userId,
        name: dto.name,
        targetAmount: dto.targetAmount,
        currency: dto.currency || 'RUB',
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      },
      include: { contributions: true },
    });
    return this.serializeGoal(goal);
  }

  async findAll(userId: number) {
    const goals = await this.prisma.goal.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        contributions: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return goals.map((g) => this.serializeGoal(g));
  }

  async findOne(userId: number, id: number) {
    const goal = await this.prisma.goal.findUnique({
      where: { id },
      include: {
        contributions: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.userId !== userId) throw new ForbiddenException('Goal does not belong to user');
    return this.serializeGoal(goal);
  }

  async update(userId: number, id: number, dto: UpdateGoalDto) {
    await this.findOne(userId, id); // ownership check
    const goal = await this.prisma.goal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
        ...(dto.currency !== undefined && { currency: dto.currency || 'RUB' }),
        ...(dto.targetDate !== undefined && { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }),
      },
      include: { contributions: true },
    });
    return this.serializeGoal(goal);
  }

  async addContribution(userId: number, goalId: number, dto: AddGoalContributionDto) {
    await this.findOne(userId, goalId); // ownership check
    await this.prisma.goalContribution.create({
      data: {
        userId,
        goalId,
        amount: dto.amount,
        currency: dto.currency || 'RUB',
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        note: dto.note,
      },
    });
    return this.findOne(userId, goalId);
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id); // ownership check
    await this.prisma.goal.update({
      where: { id },
      data: { status: 'CANCELED' },
    });
    return { message: 'Goal deleted successfully' };
  }
}

