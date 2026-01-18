import { Module } from '@nestjs/common';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  controllers: [PinController],
  providers: [PinService],
  exports: [PinService],
})
export class PinModule {}

