import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { AddAssetDto } from './dto/add-asset.dto';
import { AddLotDto } from './dto/add-lot.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('investments')
@UseGuards(JwtAccessGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  /**
   * Add an investment asset by ticker or name
   * POST /api/investments/assets
   */
  @Post('assets')
  addAsset(@CurrentUser() user: JwtAccessPayload, @Body() dto: AddAssetDto) {
    return this.investmentsService.addAsset(user.sub, dto);
  }

  /**
   * List all assets for the user
   * GET /api/investments/assets
   */
  @Get('assets')
  listAssets(@CurrentUser() user: JwtAccessPayload) {
    return this.investmentsService.listAssets(user.sub);
  }

  /**
   * Get asset by ID
   * GET /api/investments/assets/:id
   */
  @Get('assets/:id')
  getAsset(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAsset(user.sub, id);
  }

  /**
   * Delete asset (only if no lots exist)
   * DELETE /api/investments/assets/:id
   */
  @Delete('assets/:id')
  deleteAsset(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteAsset(user.sub, id);
  }

  /**
   * Add a lot (purchase) for an asset
   * POST /api/investments/lots
   */
  @Post('lots')
  addLot(@CurrentUser() user: JwtAccessPayload, @Body() dto: AddLotDto) {
    return this.investmentsService.addLot(user.sub, dto);
  }

  /**
   * Get portfolio with computed metrics
   * GET /api/investments/portfolio
   */
  @Get('portfolio')
  getPortfolio(@CurrentUser() user: JwtAccessPayload) {
    return this.investmentsService.getPortfolio(user.sub);
  }
}
