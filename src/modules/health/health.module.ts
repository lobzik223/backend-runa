import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  controllers: [HealthController],
  providers: [MaintenanceService],
})
export class HealthModule {}

