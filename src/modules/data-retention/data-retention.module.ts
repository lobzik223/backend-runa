import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DataRetentionJob } from './data-retention-job';

@Module({
  imports: [PrismaModule],
  providers: [DataRetentionJob],
})
export class DataRetentionModule {}

