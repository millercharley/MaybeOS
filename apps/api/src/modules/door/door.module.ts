import { Module } from '@nestjs/common';
import { DoorService } from './door.service';
import { DoorScriptService } from './door-script.service';
import { DoorController } from './door.controller';
import { EmailModule } from '../email/email.module';

/**
 * Door codes and the co-op's door sheet, written through its Apps Script (DOR-01).
 */
@Module({
  imports: [EmailModule],
  controllers: [DoorController],
  providers: [DoorService, DoorScriptService],
  // The scheduler runs the reconciliation pass.
  exports: [DoorService],
})
export class DoorModule {}
