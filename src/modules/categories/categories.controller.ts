import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';
import { CategoriesService } from './categories.service';
import { CategoryType } from '@prisma/client';

@Controller('categories')
@UseGuards(JwtAccessGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload, @Query('type') type?: CategoryType) {
    return this.categories.list(user.sub, type);
  }
}

