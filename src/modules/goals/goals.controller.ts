import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { AddGoalContributionDto } from './dto/add-goal-contribution.dto';

@Controller('goals')
@UseGuards(JwtAccessGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtAccessPayload) {
    return this.goals.findAll(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.goals.findOne(user.sub, id);
  }

  @Post()
  create(@CurrentUser() user: JwtAccessPayload, @Body() dto: CreateGoalDto) {
    return this.goals.create(user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGoalDto) {
    return this.goals.update(user.sub, id, dto);
  }

  @Post(':id/contributions')
  addContribution(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGoalContributionDto,
  ) {
    return this.goals.addContribution(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.goals.remove(user.sub, id);
  }
}

